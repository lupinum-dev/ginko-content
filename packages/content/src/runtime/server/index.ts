// Unified query API (ADR-0016) — exposed server-side via #content/server.
export { one, many, paginate, backlinks, resolveOne, variants, tree, neighbors, createServerContentQueryContext } from './query-api'
export { getCollectionPath } from '../query/routes'

export { queryCollectionsSitemapEntries } from './sitemap-provider'
export {
  contentCacheHeaders,
  noopContentCache,
  vercelContentCache,
  type VercelContentCacheOptions
} from './cache-adapters'
export {
  clearContentCacheHint,
  collectContentCacheHint,
  getContentCacheHint
} from './cache-hints'
export { createContentProviderError } from '../../public/provider-errors'
export { withContentCache } from '../../public/provider'
export type {
  ContentCacheAdapter,
  ContentCacheHint,
  ContentCacheHintInput,
  ContentCacheInvalidateInput,
  ContentProvider,
  ContentProviderCapabilities,
  ContentProviderResult,
  MaybeContentProviderResult
} from '../../public/provider'
export type { ContentProviderErrorCode } from '../../public/provider-errors'
