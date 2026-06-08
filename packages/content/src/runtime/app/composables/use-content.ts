/**
 * Public facade for Layer 2 of the unified query API (ADR-0016).
 *
 * Runtime imports and `#content/client` intentionally keep pointing at this
 * module; focused implementation modules live beside it.
 */
export { useContentOne, useContentResolveOne } from './use-content-document'
export { useContentPage } from './use-content-page'
export type { UseContentPageOptions } from './use-content-page'
export { useContentMany, useContentPagination, useContentBacklinks, useContentVariants } from './use-content-list'
export { useContentTree, useContentNavigation, useContentNeighbors } from './use-content-navigation'
export type { ContentNavigationNode } from './use-content-navigation'

// Re-export the underlying types so consumers can avoid pulling from internal paths.
export type {
  ManyOptions,
  OneOptions,
  BacklinksOptions,
  BacklinksResult,
  LocalizedDoc,
  ContentResolvedMeta,
  ContentCollectionTarget,
  DocumentFromHandle,
  NeighborsOptions,
  NeighborsResult,
  PaginationOptions,
  PaginationResult,
  PopulateSpec,
  PopulateFromOptions,
  PopulatedDocument,
  ResolveOneOptions,
  ResolveOneResult,
  SortSpec,
  TreeOptions,
  VariantsOptions,
  ContentVariant
} from '../../../types/query'
