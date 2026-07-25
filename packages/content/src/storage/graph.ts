import type { H3Event } from 'h3'
import type { ContentGraph } from '../core/content/graph'
import {
  buildContentGraph,
  resolveGraphCanonicalKey,
  resolveGraphRouteVariant,
  resolveGraphVariant
} from '../core/content/graph'
import { memoizeRuntimeValue } from '../integrations/nitro/context'
import { assertFilesystemPreviewSupported, resolveRuntimeEnvironment } from '../core/visibility'
import { isPreview } from '../integrations/nitro/preview'
import { providerReferencePathAliases } from '../features/localization/reference-path'
import { getContentRuntimeConfig } from '../integrations/nitro/runtime-config'
import { contentConfig } from './driver'
import { getContentsList } from './contents'
import { getProcessGraph, usesProcessSnapshot } from './snapshot-runtime'

/**
 * The sealed filesystem snapshot is the one choke point every filesystem
 * query dispatch passes through (query executor, navigation, sitemap,
 * search, agent output, collection helpers). Asserting production-preview
 * support here — before the snapshot is loaded or read — guarantees the
 * guard covers all of them without duplicating it at each call site
 *. `storage/snapshot-runtime.ts#getProcessSnapshotState`
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
    const localePolicies = config.localePolicy?.collections
    return buildContentGraph(contents, {
      locales: config.locales,
      defaultLocale: config.defaultLocale,
      ...(localePolicies
        ? {
            referencePathAliases: (document: import('../types/content').ParsedContent) =>
              providerReferencePathAliases(document, localePolicies)
          }
        : {})
    })
  })
}

/**
 * Graph-backed variant, route, and reference resolution helpers. The graph is
 * the one manifest source: it is process-cached by snapshot integrity in
 * production and memoized per request in development.
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
