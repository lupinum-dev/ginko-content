import type { H3Event } from 'h3'
import type { ContentCacheHint } from '../core/cache-hints'
import type { JsonValue } from '../core/json-value'
import type { MaybeContentProviderResult } from '../core/provider-result'
import type { ContentQueryResponse } from '../types/api'
import type { ContentProviderName } from '../types/config'
import type { ContentProviderSearchRequest } from '../types/search'
import type { ContentSitemapMetadata } from '../features/sitemap/metadata'
import { isProviderCapabilityOperatorList, type ProviderCapabilityOperator } from '../core/query/operators'
import type {
  ContentProviderPaginationMode,
  ContentProviderQuery
} from './provider-query'
import type { ProviderDocumentInput } from './provider-document'

export interface ContentCacheInvalidateInput {
  tags?: string[]
  paths?: string[]
}

export interface ContentCacheAdapter {
  name: string
  apply: (event: H3Event, hint: ContentCacheHint) => void | Promise<void>
  /**
   * Purge cached content after an authenticated revalidation request.
   * Omit this capability when the adapter only applies response metadata.
   */
  invalidate?: (input: ContentCacheInvalidateInput) => Promise<void>
}

export interface ContentProviderSiteDataRequest {
  key: string
  locale?: string
}

export interface ContentProviderSiteDataResponse {
  data: JsonValue | null
  updatedAt?: number
}

export interface ContentProviderCapabilities {
  query: {
    operators: readonly ProviderCapabilityOperator[]
    /** Pagination behavior the provider implements. */
    pagination: readonly ContentProviderPaginationMode[]
  }
}

export type { ProviderCapabilityOperator }

export const isContentProviderOperatorCapabilities = (value: unknown): value is readonly ProviderCapabilityOperator[] =>
  isProviderCapabilityOperatorList(value)

export const isContentProviderPaginationCapabilities = (value: unknown): value is readonly ContentProviderPaginationMode[] =>
  Array.isArray(value) &&
  value.every(mode => mode === 'offset' || mode === 'cursor') &&
  new Set(value).size === value.length

export const isContentProviderQueryCapabilities = (value: unknown): value is ContentProviderCapabilities['query'] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const query = value as Record<string, unknown>
  return isContentProviderOperatorCapabilities(query.operators) &&
    isContentProviderPaginationCapabilities(query.pagination)
}

/**
 * Raw route identity returned by every provider surface.
 *
 * `contentPath` is the collection's locale-specific mounted, site-relative
 * path, but never carries the application locale prefix. For example, a
 * German document mounted at `/anleitung` may return
 * `/anleitung/einstieg`, not `/de/anleitung/einstieg` and not `/einstieg`.
 */
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
  query: (event: H3Event, query: ContentProviderQuery) => Promise<MaybeContentProviderResult<ContentQueryResponse<ProviderDocumentInput>>>
  navigation?: (event: H3Event, query: ContentProviderQuery) => Promise<MaybeContentProviderResult<ContentProviderNavigationItem[]>>
  surroundings?: (event: H3Event, collection: string, contentPath: string, options?: ContentProviderSurroundingsOptions) => Promise<MaybeContentProviderResult<Array<ContentProviderSurroundItem | null>>>
  search?: (event: H3Event, request: ContentProviderSearchRequest) => Promise<MaybeContentProviderResult<ContentProviderSearchResult[]>>
  siteData?: (event: H3Event, request: ContentProviderSiteDataRequest) => Promise<MaybeContentProviderResult<ContentProviderSiteDataResponse>>
  routes?: (event: H3Event) => Promise<MaybeContentProviderResult<ContentRouteRecord[]>>
}
