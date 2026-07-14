import type { H3Event } from 'h3'
import type { ContentQueryResponse } from '../types/api'
import type { ParsedContent } from '../types/content'
import type { ContentProviderName } from '../types/config'
import type { ContentSitemapImage } from '../types/query'
import type { ContentProviderSearchRequest } from '../types/search'
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
export { normalizeProviderDocument } from '../runtime/server/provider-document.js'
export type { ProviderDocumentInput, ContentProviderVariantFact } from '../runtime/server/provider-document.js'
export { bindContentProvider } from './provider-binder.js'

const contentProviderResultMarker = Symbol.for('ginko.content.provider-result')

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

export const isContentProviderResult = <T = unknown>(value: unknown): value is ContentProviderResult<T> =>
  Boolean(value)
  && typeof value === 'object'
  && (value as ContentProviderResult<T>)[contentProviderResultMarker] === true

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
  query: {
    operators: readonly string[]
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

/** Raw, pre-locale-prefix route identity returned by every provider surface. */
export interface ContentProviderRouteFact {
  collection: string
  canonicalKey: string
  locale: string
  contentPath: string
}

export interface ContentSitemapMetadata {
  lastmod?: string
  images?: readonly ContentSitemapImage[]
}

/** A structurally valid provider route candidate. Consumer policy is applied by core. */
export interface ContentRouteRecord extends ContentProviderRouteFact {
  draft?: boolean
  sitemap?: false | ContentSitemapMetadata
}

export interface ContentProviderNavigationItem {
  title: string
  route?: ContentProviderRouteFact
  children?: ContentProviderNavigationItem[]
  [selectedField: string]: unknown
}

export interface ContentProviderSurroundItem {
  title: string
  route: ContentProviderRouteFact
  [selectedField: string]: unknown
}

export interface ContentProviderSearchResult {
  title: string
  excerpt?: string
  score: number
  route: ContentProviderRouteFact
  [selectedField: string]: unknown
}

export interface ContentProviderSurroundingsOptions {
  locale?: string
  fallback?: boolean | readonly string[]
  select?: readonly string[]
}

export interface ContentProvider {
  name: ContentProviderName
  capabilities: ContentProviderCapabilities
  query: <T = ParsedContent>(event: H3Event, query: ContentProviderQuery) => Promise<MaybeContentProviderResult<ContentQueryResponse<T>>>
  navigation?: (event: H3Event, query: ContentProviderQuery, options?: ContentProviderNavigationOptions) => Promise<MaybeContentProviderResult<ContentProviderNavigationItem[]>>
  surroundings?: (event: H3Event, collection: string, contentPath: string, options?: ContentProviderSurroundingsOptions) => Promise<MaybeContentProviderResult<Array<ContentProviderSurroundItem | null>>>
  search?: (event: H3Event, request: ContentProviderSearchRequest) => Promise<MaybeContentProviderResult<ContentProviderSearchResult[]>>
  siteData?: <T = unknown>(event: H3Event, request: ContentProviderSiteDataRequest) => Promise<MaybeContentProviderResult<ContentProviderSiteDataResponse<T>>>
  routes?: (event: H3Event) => Promise<MaybeContentProviderResult<ContentRouteRecord[]>>
}
