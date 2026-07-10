import type { H3Event } from 'h3'
import type { ContentQueryResponse } from '../types/api'
import type { NavItem, ParsedContent } from '../types/content'
import type { ContentProviderName } from '../types/config'
import type {
  ContentCollectionItemSurroundingsOptions,
  ContentCollectionNavigationOptions,
  ContentCollectionPageOptions,
  ContentCollectionRouteMetaOptions,
  ContentCollectionSearchSectionsOptions,
  ContentPageResult,
  ContentRouteMeta,
  ContentSearchSection,
  ContentSitemapEntry
} from '../types/query'
import type { QueryCollectionsSitemapEntriesOptions } from '../features/sitemap/query'
import type { ContentProviderSearchRequest, ContentSearchResult } from '../types/search'
import type { ContentCacheHint, ContentCacheHintInput } from '../core/cache-hints'
import type { ContentProviderNavigationOptions, ContentProviderPaginationMode, ContentProviderQuery } from './provider-query'

export type { ContentCacheHint, ContentCacheHintInput } from '../core/cache-hints'
export type {
  ContentProviderQuery,
  ContentProviderNavigationOptions,
  ContentQueryPlan,
  ContentProviderPaginationMode,
  ContentProviderPaging,
  ContentProviderVariantSelector,
  ContentProviderListResponse
} from './provider-query'
export { PROVIDER_QUERY_VERSION, toContentProviderQuery, toContentProviderNavigationQuery } from './provider-query'
export { createContentProviderError } from './provider-errors'
export type { ContentProviderErrorCode } from './provider-errors'
export { normalizeProviderDocument, shapeProviderDocument } from '../runtime/server/provider-document.js'
export type { ProviderDocumentInput, ShapeProviderDocumentOptions } from '../runtime/server/provider-document.js'

export const contentProviderResultMarker = '__ginkoContentProviderResult'

export interface ContentProviderResult<T = unknown> {
  readonly [contentProviderResultMarker]: true
  data: T
  cache: ContentCacheHintInput
}

export type MaybeContentProviderResult<T = unknown> = T | ContentProviderResult<T>

export const withContentCache = <T>(data: T, cache: ContentCacheHintInput): ContentProviderResult<T> => ({
  [contentProviderResultMarker]: true,
  data,
  cache
})

export interface ContentCacheInvalidateInput {
  tags?: string[]
  paths?: string[]
}

export interface ContentCacheAdapter {
  name: string
  apply: (event: H3Event, hint: ContentCacheHint) => void | Promise<void>
  invalidate: (input: ContentCacheInvalidateInput) => Promise<void>
}

export interface ContentProviderSiteDataRequest {
  key: string
  locale?: string
}

export interface ContentProviderSiteDataResponse<T = unknown> {
  key?: string
  locale?: string
  data?: T | null
  updatedAt?: number
}

export interface ContentProviderCapabilities {
  routeBackedCollections: boolean
  dataCollections: boolean
  localizedRoutes: boolean
  translatedSlugs: boolean
  navigation: boolean
  surroundings: boolean
  searchSections: boolean
  sitemap: boolean
  query: {
    operators: string[]
    /**
     * Advertised pagination modes (VNEXT.md 13.1). `offset` guarantees skip
     * plus an exact total; `cursor` guarantees an opaque forward cursor with
     * no synthetic total. Replaces the old `limit`/`skip`/`count` booleans —
     * `limit` alone needs no capability (every provider can bound its
     * natural order), and the `count` terminal is available only when
     * `offset` is advertised.
     */
    pagination: readonly ContentProviderPaginationMode[]
  }
}

export interface ContentProvider {
  name: ContentProviderName
  capabilities: ContentProviderCapabilities
  query: <T = ParsedContent>(event: H3Event, query: ContentProviderQuery) => Promise<MaybeContentProviderResult<ContentQueryResponse<T>>>
  navigationQuery?: (event: H3Event, query: ContentProviderQuery, options?: ContentProviderNavigationOptions) => Promise<MaybeContentProviderResult<NavItem[]>>
  navigation?: (event: H3Event, collection: string, options?: string[] | ContentCollectionNavigationOptions) => Promise<MaybeContentProviderResult<NavItem[]>>
  surroundings?: (event: H3Event, collection: string, path: string, options?: ContentCollectionItemSurroundingsOptions) => Promise<MaybeContentProviderResult<Array<NavItem | null>>>
  searchSections?: (event: H3Event, collection: string, options?: ContentCollectionSearchSectionsOptions) => Promise<MaybeContentProviderResult<ContentSearchSection[]>>
  search?: (event: H3Event, request: ContentProviderSearchRequest) => Promise<MaybeContentProviderResult<ContentSearchResult[]>>
  siteData?: <T = unknown>(event: H3Event, request: ContentProviderSiteDataRequest) => Promise<MaybeContentProviderResult<ContentProviderSiteDataResponse<T>>>
  page?: <T = ParsedContent>(event: H3Event, collection: string, routeOrPath?: string, options?: ContentCollectionPageOptions) => Promise<MaybeContentProviderResult<ContentPageResult<T> | null>>
  routeMeta?: (event: H3Event, collection: string, routeOrPath?: string, options?: ContentCollectionRouteMetaOptions) => Promise<MaybeContentProviderResult<ContentRouteMeta | null>>
  sitemapEntries?: (event: H3Event, options?: QueryCollectionsSitemapEntriesOptions) => Promise<MaybeContentProviderResult<ContentSitemapEntry[]>>
  invalidate?: (event: H3Event, input: ContentCacheInvalidateInput) => Promise<void>
}
