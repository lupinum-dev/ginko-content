import type { H3Event } from 'h3'
import type { ContentCacheHint } from '../core/cache-hints'
import type { MaybeContentProviderResult } from '../core/provider-result'
import type { ContentQueryResponse } from '../types/api'
import type { ParsedContent } from '../types/content'
import type { ContentProviderName } from '../types/config'
import type { ContentProviderSearchRequest } from '../types/search'
import type { ContentSitemapMetadata } from '../features/sitemap/metadata'
import type {
  ContentProviderNavigationOptions,
  ContentProviderPaginationMode,
  ContentProviderQuery
} from './provider-query'

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
    /** Pagination behavior the provider implements. */
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

export type { ContentSitemapMetadata } from '../features/sitemap/metadata'

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
