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
  navigation
} from '../runtime/server/query-api.js'

export { getCollectionPath } from '../features/query/routes.js'
export type { CollectionPathOptions } from '../features/query/routes.js'
export { findFirstNavigationPage } from '../features/navigation/resolve.js'

export type {
  QueryWhere,
  QueryOperators,
  ContentSelector,
  ContentSearchSection,
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
  LocalizedContentDocument,
  ResolutionEnvelope,
  SortSpec,
  ContentAlternate,
  ContentDocumentRoute,
  ContentDocumentResolution,
  ContentNavigationItem,
  ContentCollectionName,
  ContentCollectionTarget,
  SurroundOptions,
  SurroundResult,
  NavigationOptions,
  ContentNavigationTreeItem,
  ResolvedContentNavigationItem,
  PaginationMode,
  OffsetPaginationResult,
  CursorPaginationResult
} from '../types/query.js'

export type { ContentPublicQueryResponse, ContentQueryResponse } from '../types/api.js'

export const queryCollectionsSitemapEntries: typeof import('../runtime/server/sitemap-provider.js').queryCollectionsSitemapEntries = async (...args) => {
  const { queryCollectionsSitemapEntries } = await import('../runtime/server/sitemap-provider.js')
  return await queryCollectionsSitemapEntries(...args)
}

export {
  contentCacheHeaders,
  headersContentCache
} from '../runtime/server/cache-adapters.js'
export {
  clearContentCacheHint,
  collectContentCacheHint,
  getContentCacheHint
} from '../runtime/server/cache-hints.js'
