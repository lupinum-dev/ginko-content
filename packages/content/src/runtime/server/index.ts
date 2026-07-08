// Unified query API (ADR-0016) — exposed server-side via #content/server.
export { one, many, paginate, backlinks, resolveOne, variants, tree, neighbors, createServerContentQueryContext } from './query-api'
export { getCollectionPath } from '../../features/query/routes'

export { queryCollectionsSitemapEntries } from './sitemap-provider'
export {
  contentCacheHeaders,
  noopContentCache,
  vercelContentCache,
  headersContentCache,
  type VercelContentCacheOptions
} from './cache-adapters'
export {
  clearContentCacheHint,
  collectContentCacheHint,
  getContentCacheHint
} from './cache-hints'
export { createContentProviderError } from '../../public/provider-errors'
export {
  PROVIDER_QUERY_VERSION,
  toContentProviderNavigationQuery,
  toContentProviderQuery,
  withContentCache
} from '../../public/provider'
// Provider-author seam (T3.4): keep the #content/server alias in lockstep with
// the ./server subpath — providers import these from either specifier.
export { normalizeProviderDocument, shapeProviderDocument } from './provider-document'
export type { ProviderDocumentInput, ShapeProviderDocumentOptions } from './provider-document'
export type {
  ContentCacheAdapter,
  ContentCacheHint,
  ContentCacheHintInput,
  ContentCacheInvalidateInput,
  ContentProvider,
  ContentProviderCapabilities,
  ContentProviderNavigationOptions,
  ContentProviderQuery,
  ContentProviderResult,
  MaybeContentProviderResult
} from '../../public/provider'
export type { ContentProviderErrorCode } from '../../public/provider-errors'
