import type { H3Event } from 'h3'
import type { ParsedContent } from '../types/content'
import type { ContentLocaleEntry, ContentQueryRequest } from '../types/query'
import type { ContentGraph } from '../core/content/graph'
import {
  buildContentGraph,
  resolveGraphCanonicalKey,
  resolveGraphCollectionLocales,
  resolveGraphRouteVariant,
  resolveGraphVariant,
  resolveLocaleChain,
  selectGraphDocuments
} from '../core/content/graph'
import { collectQueryWhere } from '../core/query/params'
import { memoizeRuntimeValue } from '../integrations/nitro/context'
import { assertFilesystemPreviewSupported, resolveRuntimeEnvironment } from '../core/visibility'
import { isPreview } from '../integrations/nitro/preview'
import { getContentRuntimeConfig } from '../integrations/nitro/runtime-config'
import { contentConfig } from './driver'
import { getContentsList } from './contents'
import { getProcessGraph, usesProcessSnapshot } from './snapshot-runtime'

export { resolveLocaleChain }

/**
 * The sealed filesystem snapshot is the one choke point every filesystem
 * query dispatch passes through (query executor, navigation, sitemap,
 * search, agent output, collection helpers). Asserting production-preview
 * support here — before the snapshot is loaded or read — guarantees the
 * guard covers all of them without duplicating it at each call site
 * (VNEXT.md 15.8, 24.3). `storage/snapshot-runtime.ts#getProcessSnapshotState`
 * asserts the same thing as a defense-in-depth backstop for the direct
 * `getProcessDocuments` callers in `storage/contents.ts`.
 */
export const getContentGraph = async (event: H3Event): Promise<ContentGraph> => {
  if (usesProcessSnapshot) {
    assertFilesystemPreviewSupported({
      environment: resolveRuntimeEnvironment(),
      previewAuthorized: isPreview(event)
    })
    return getProcessGraph(event)
  }

  return await memoizeRuntimeValue(event, 'graph', async () => {
    const config = contentConfig()
    const contents = await getContentsList(event)
    return buildContentGraph(contents, {
      locales: config.locales,
      defaultLocale: config.defaultLocale
    })
  })
}

/**
 * Graph-backed variant/route/reference resolution helpers.
 *
 * These used to live behind a persisted `_manifest.json` cache
 * (`storage/manifest.ts`, deleted — VNEXT.md 15.7, 25.4): that cache was a
 * second, revisionless snapshot of `getContentGraph(event).manifest` with no
 * invalidation source of its own. `getContentGraph` already resolves to the
 * one process-cached graph in production (keyed by snapshot integrity) and a
 * per-request memoized graph in dev, so these helpers call it directly.
 */
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
    locales: config.locales,
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
    locales: config.locales,
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
  const params = query.params()
  const paths = collectQueryWhere(params?.where, where => typeof where.path !== 'undefined')
    .map(where => where.path)
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
