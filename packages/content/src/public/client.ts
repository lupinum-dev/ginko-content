/**
 * Client-side public API surface (browser + SSR Vue).
 *
 * The unified query API (ADR-0016) is the supported core read path. Route
 * pages use the thin `useContentPage` convenience helper built on top of it.
 */
export {
  one,
  many,
  paginate,
  backlinks,
  resolveOne,
  variants,
  tree,
  neighbors
} from '../runtime/app/composables/query-api.js'

export { getCollectionPath } from '../runtime/query/routes.js'
export type { CollectionPathOptions } from '../runtime/query/routes.js'

export {
  useContentPage,
  useContentOne,
  useContentMany,
  useContentPagination,
  useContentBacklinks,
  useContentResolveOne,
  useContentVariants,
  useContentTree,
  useContentNeighbors,
  useContentLocaleSwitch
} from '../runtime/app/composables/use-content.js'
export type { UseContentPageOptions } from '../runtime/app/composables/use-content.js'

export type {
  QueryWhere,
  QueryOperators,
  ContentSelector,
  ContentResolvedMeta,
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
  LocalePathEntry,
  NeighborsOptions,
  NeighborsResult,
  ResolutionEnvelope,
  SortSpec,
  TreeOptions,
  VariantsOptions,
  ContentVariant,
  ContentNavigationItem,
  ContentCollectionName,
  ContentCollectionStringName,
  ContentCollectionTarget,
  ContentTreeItem,
  ContentRouteMeta,
  ContentSearchSection
} from '../types/query.js'

// Search (kept — out of scope for ADR-0016).
export { useContentSearch, useContentSearchData, useContentSearchResults } from '../runtime/app/composables/search.js'
export type {
  UseContentSearchDataOptions,
  UseContentSearchDataResult,
  UseContentSearchOptions,
  UseContentSearchResult,
  UseContentSearchResultsOptions,
  UseContentSearchResultsResult
} from '../runtime/app/composables/search.js'

// Site data (kept — auxiliary helper, not a query API).
export { querySiteData } from '../runtime/app/composables/site-data.js'
export type { ContentSiteDataResponse, QuerySiteDataOptions } from '../runtime/app/composables/site-data.js'

// Table of contents (kept — derived from rendered markdown body).
export { extractContentToc, useContentToc } from '../runtime/app/composables/toc.js'
export type { ContentTocOptions } from '../runtime/app/composables/toc.js'
export type { ContentSeoImage, ContentSeoMeta, Toc, TocLink } from '../types/content.js'
