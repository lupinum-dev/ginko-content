// Unified query API (ADR-0016) — exposed server-side via #content/server.
export { one, many, paginate, backlinks, resolveOne, surround, navigation } from './query-api'
export { getCollectionPath } from '../../features/query/routes'

export { queryCollectionsSitemapEntries } from './sitemap-provider'
export {
  contentCacheHeaders,
  headersContentCache
} from './cache-adapters'
export {
  clearContentCacheHint,
  collectContentCacheHint,
  getContentCacheHint
} from './cache-hints'
