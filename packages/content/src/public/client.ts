/**
 * Client-side public API surface (browser + SSR Vue).
 *
 * The unified query API (ADR-0016) is the supported core read path. The
 * public composable surface is exactly `useContentPage` and
 * `useContentSearch`; every other application workflow is
 * ordinary Nuxt composition over the one-shot async query operations below.
 */
export {
  one,
  many,
  count,
  paginate,
  backlinks,
  resolveOne,
  surround,
  navigation
} from '../runtime/app/composables/query-api.js'

export { getCollectionPath } from '../features/query/routes.js'
export type { CollectionPathOptions } from '../features/query/routes.js'
export { findFirstNavigationPage } from '../features/navigation/resolve.js'

export { useContentPage } from '../runtime/app/composables/use-content-page.js'
export type { UseContentPageOptions } from '../runtime/app/composables/use-content-page.js'

export type {
  QueryWhere,
  QueryOperators,
  ContentSelector,
  BacklinkFields,
  BacklinkSource,
  BacklinksOptions,
  BacklinksResult,
  CountOptions,
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
  ContentSearchSection,
  SurroundOptions,
  SurroundResult,
  NavigationOptions,
  ContentNavigationTreeItem,
  ResolvedContentNavigationItem,
  PaginationMode,
  OffsetPaginationResult,
  CursorPaginationResult
} from '../types/query.js'

export type { ContentPublicQueryResponse } from '../types/api.js'

// Search (kept — out of scope for ADR-0016).
export { useContentSearch } from '../runtime/app/composables/search.js'
export type {
  UseContentSearchOptions,
  UseContentSearchResult
} from '../runtime/app/composables/search.js'

// Site data (kept — auxiliary helper, not a query API).
export { querySiteData } from '../runtime/app/composables/site-data.js'
export type { ContentSiteDataResponse, QuerySiteDataOptions } from '../runtime/app/composables/site-data.js'

// Table of contents (kept — pure derivation from a rendered markdown body).
export { extractContentToc } from '../runtime/app/composables/toc.js'
export type { ContentTocOptions } from '../runtime/app/composables/toc.js'
export type { ContentSeoImage, ContentSeoMeta, Toc, TocLink } from '../types/content.js'
