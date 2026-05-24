import type { H3Event } from 'h3'
import type { ParsedContent } from '../types/content'
import type { ContentLocaleEntry, ContentQueryRequest } from '../types/query'
import type { ContentManifest } from '../types/runtime'
import { resolveGraphCanonicalKey, resolveGraphCollectionLocales, resolveGraphRouteVariant, resolveGraphVariant, resolveLocaleChain, selectGraphDocuments } from '../core/content/graph'
import { collectQueryWhere } from '../core/query/params'
import { isPreview } from '../integrations/nitro/preview'
import { getContentRuntimeConfig } from '../integrations/nitro/runtime-config'
import { getContentsList } from './contents'
import { cacheStorage } from './driver'
import { getContentGraph } from './graph'

const isManifestCacheValid = (manifest: ContentManifest | null): manifest is ContentManifest => {
  return Boolean(
    manifest
    && typeof manifest === 'object'
    && manifest.byCanonical
    && manifest.byRef
    && manifest.byRoute
    && manifest.paths
    && manifest.collections
  )
}

const hasRequestContext = (event: H3Event) => {
  return Boolean((event as H3Event & { node?: { req?: unknown } }).node?.req)
}

export { resolveLocaleChain }

export async function getContentManifest (event: H3Event) {
  if (!hasRequestContext(event) || !isPreview(event)) {
    const cached = await cacheStorage(event).getItem('_manifest.json') as ContentManifest | null
    if (isManifestCacheValid(cached)) {
      return cached
    }
  }

  const graph = await getContentGraph(event)
  if (!hasRequestContext(event) || !isPreview(event)) {
    await cacheStorage(event).setItem('_manifest.json', graph.manifest)
  }

  return graph.manifest
}

export async function resolveVariant (
  event: H3Event,
  canonicalKey: string,
  requestedLocale?: string,
  options: {
    fallback?: string[]
    exact?: boolean
  } = {}
) {
  const config = getContentRuntimeConfig().content
  return resolveGraphVariant(await getContentGraph(event), canonicalKey, requestedLocale, {
    defaultLocale: config.defaultLocale,
    fallback: options.fallback,
    exact: options.exact,
    localeFallback: config.localeFallback
  })
}

export async function resolveRouteVariant (
  event: H3Event,
  routePath: string,
  requestedLocale?: string,
  options: {
    fallback?: string[]
    exact?: boolean
  } = {}
) {
  const config = getContentRuntimeConfig().content
  return resolveGraphRouteVariant(await getContentGraph(event), routePath, requestedLocale, {
    defaultLocale: config.defaultLocale,
    fallback: options.fallback,
    exact: options.exact,
    localeFallback: config.localeFallback
  })
}

export async function resolveCanonicalKey (
  event: H3Event,
  identity: string,
  collection?: string
) {
  return resolveGraphCanonicalKey(await getContentGraph(event), identity, collection)
}

export async function resolveCollectionLocales (
  event: H3Event,
  identity: string,
  collection?: string
): Promise<ContentLocaleEntry[]> {
  return resolveGraphCollectionLocales(await getContentGraph(event), identity, collection)
}

export async function getIndexedContentsList (event: H3Event, query: ContentQueryRequest): Promise<ParsedContent[]> {
  if (hasRequestContext(event) && isPreview(event)) {
    return await getContentsList(event)
  }

  const params = query.params()
  const paths = collectQueryWhere(params?.where, where => typeof where._path !== 'undefined')
    .map(where => where._path)
    .filter((path): path is string | RegExp => typeof path === 'string' || path instanceof RegExp)
  const graph = await getContentGraph(event)

  if (!paths.length && !params?.collection) {
    return graph.documents
  }

  return selectGraphDocuments(graph, {
    collection: params?.collection,
    paths
  })
}
