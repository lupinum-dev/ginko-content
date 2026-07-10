/**
 * Server-side public API surface (Nitro / H3 contexts).
 *
 * The unified query API (ADR-0016) is the same on the server as on the client
 * — same option shapes, same handle objects, same types. Pure functions are
 * re-exported here for ergonomic discoverability from `@lupinum/ginko-content/server`.
 */
export {
  one,
  many,
  paginate,
  backlinks,
  resolveOne,
  surround,
  navigation,
  createServerContentQueryContext
} from '../runtime/server/query-api.js'

export { getCollectionPath } from '../features/query/routes.js'
export type { CollectionPathOptions } from '../features/query/routes.js'

export type {
  QueryWhere,
  QueryOperators,
  ContentSelector,
  ContentPageResult,
  ContentRouteMeta,
  ContentSearchSection,
  ContentResolvedMeta,
  ContentSitemapEntry,
  BacklinkFields,
  BacklinkSource,
  BacklinksOptions,
  BacklinksResult,
  LocaleFallback,
  DocumentFromHandle,
  OneOptions,
  ManyOptions,
  PaginationOptions,
  PaginationResult,
  PopulateSpec,
  PopulatedDocument,
  ResolveOneOptions,
  ResolveOneResult,
  LocalizedDoc,
  LocalizedContentDocument,
  LocalePathEntry,
  SortSpec,
  SurroundOptions,
  SurroundResult,
  NavigationOptions,
  ContentNavigationTreeItem,
  PaginationMode,
  OffsetPaginationResult,
  CursorPaginationResult
} from '../types/query.js'

export type { ContentQueryResponse } from '../types/api.js'

export const queryCollectionsSitemapEntries: typeof import('../runtime/server/sitemap-provider.js').queryCollectionsSitemapEntries = async (...args) => {
  const { queryCollectionsSitemapEntries } = await import('../runtime/server/sitemap-provider.js')
  return await queryCollectionsSitemapEntries(...args)
}

export { createContentProviderError } from './provider-errors.js'
export {
  contentCacheHeaders,
  noopContentCache,
  vercelContentCache,
  headersContentCache,
  type VercelContentCacheOptions
} from '../runtime/server/cache-adapters.js'
export {
  clearContentCacheHint,
  collectContentCacheHint,
  getContentCacheHint
} from '../runtime/server/cache-hints.js'
export { PROVIDER_QUERY_VERSION, toContentProviderNavigationQuery, toContentProviderQuery, withContentCache } from './provider.js'
export { normalizeProviderDocument, shapeProviderDocument } from '../runtime/server/provider-document.js'
export type { ProviderDocumentInput, ShapeProviderDocumentOptions } from '../runtime/server/provider-document.js'
