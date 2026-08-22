import type { ContentQueryResponse } from '../types/api'
import type { ContentProviderSearchRequest } from '../types/search'
import type { JsonValue } from '../core/json-value'
import type { ProviderDocumentInput } from './provider-document'
import type {
  ContentProviderNavigationItem,
  ProviderCapabilityOperator,
  ContentProviderSearchResult,
  ContentProviderSiteDataRequest,
  ContentProviderSurroundItem,
  ContentProviderSurroundingsOptions,
  ContentRouteRecord,
} from './provider-contract'
import type {
  ContentProviderPaginationMode,
  ContentProviderQuery,
  ContentProviderQueryPlan,
  ContentQueryPagination,
} from './provider-query'
import { CONTENT_ROUTE_LIMITS } from '../core/provider-route-record'

export { createContentDataSourceError } from '../core/data-source-error'
export type { ContentDataSourceErrorCode } from '../core/data-source-error'

export const CONTENT_DATA_SOURCE_LIMITS = Object.freeze({
  maxQueryPageSize: 100,
  maxSearchResults: 100,
  maxRoutePageSize: 250,
  maxTotalRoutes: 100_000,
  ...CONTENT_ROUTE_LIMITS,
  maxNavigationNodes: 2_000,
  maxSurroundItems: 2,
  maxSiteDataBytes: 256 * 1024,
  maxProviderErrorMessageBytes: 2 * 1024,
  maxProviderErrorDetailsBytes: 16 * 1024,
  maxCacheTags: 64,
  maxCachePaths: 64,
  maxCacheKeyBytes: 256,
  maxCacheTtlSeconds: 86_400,
  maxBackendDurationMs: 10_000,
})

export interface ContentDataSourceCacheHint {
  tags: string[]
  paths: string[]
  maxAge: number | null
  swr: number | null
  etag: string | null
  lastModified: number | null
}

export type CreateContentDataSourceCacheHintInput = Partial<ContentDataSourceCacheHint>

const cacheHintKeys = new Set(['etag', 'lastModified', 'maxAge', 'paths', 'swr', 'tags'])
const credentialPattern = /https?:\/\/[^/@\s]+@|[?&](?:access_token|api[_-]?key|token|secret|password)=/i
const utf8Bytes = (value: string) => new TextEncoder().encode(value).length

/** Create one bounded cache hint. Ginko Content remains the sole merge authority. */
export function createContentDataSourceCacheHint(
  input: CreateContentDataSourceCacheHintInput = {},
): ContentDataSourceCacheHint {
  if (
    !input
    || typeof input !== 'object'
    || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
    || Object.keys(input).some(key => !cacheHintKeys.has(key))
  ) {
    throw new TypeError('Content data-source cache hint has an invalid shape.')
  }
  const tags = input.tags ?? []
  const paths = input.paths ?? []
  const validateKeys = (values: string[], maximum: number, label: 'tags' | 'paths') => {
    if (!Array.isArray(values) || values.length > maximum) {
      throw new TypeError(`Content data-source cache ${label} exceed the limit.`)
    }
    for (const value of values) {
      if (
        typeof value !== 'string'
        || !value
        || value !== value.normalize('NFC')
        || utf8Bytes(value) > CONTENT_DATA_SOURCE_LIMITS.maxCacheKeyBytes
        || (label === 'paths' && !value.startsWith('/'))
      ) {
        throw new TypeError(`Content data-source cache ${label} contain an invalid value.`)
      }
      if (credentialPattern.test(value)) {
        throw new TypeError(`Content data-source cache ${label} contain credentials.`)
      }
    }
  }
  validateKeys(tags, CONTENT_DATA_SOURCE_LIMITS.maxCacheTags, 'tags')
  validateKeys(paths, CONTENT_DATA_SOURCE_LIMITS.maxCachePaths, 'paths')
  const maxAge = input.maxAge ?? null
  const swr = input.swr ?? null
  for (const value of [maxAge, swr]) {
    if (value !== null && (
      !Number.isInteger(value)
      || value < 0
      || value > CONTENT_DATA_SOURCE_LIMITS.maxCacheTtlSeconds
    )) {
      throw new TypeError('Content data-source cache TTL exceeds the limit.')
    }
  }
  const lastModified = input.lastModified ?? null
  if (lastModified !== null && (!Number.isSafeInteger(lastModified) || lastModified < 0)) {
    throw new TypeError('Content data-source lastModified is invalid.')
  }
  const etag = input.etag ?? null
  if (etag !== null && (
    typeof etag !== 'string'
    || !etag
    || utf8Bytes(etag) > CONTENT_DATA_SOURCE_LIMITS.maxCacheKeyBytes
    || credentialPattern.test(etag)
  )) {
    throw new TypeError('Content data-source ETag is invalid.')
  }
  return {
    tags: [...new Set(tags)],
    paths: [...new Set(paths)],
    maxAge,
    swr,
    etag,
    lastModified,
  }
}

export interface ContentDataSourceResult<T> {
  data: T
  cache: ContentDataSourceCacheHint | false
}

type AllPlan = Omit<ContentProviderQueryPlan, 'mode' | 'pagination'> & {
  mode: 'all'
  pagination: ContentQueryPagination & { limit: number }
}
type FirstPlan = Omit<ContentProviderQueryPlan, 'mode' | 'pagination'> & {
  mode: 'first'
  pagination: { mode: 'slice', skip: number, limit: 1 }
}
type CountPlan = Omit<ContentProviderQueryPlan, 'mode' | 'pagination'> & {
  mode: 'count'
  pagination: { mode: 'slice', skip: number, limit?: never }
}

export type BoundedContentProviderQuery = Omit<ContentProviderQuery, 'plan'> & {
  plan: AllPlan | FirstPlan | CountPlan
}

export interface ContentDataSourceControl {
  signal: AbortSignal
  deadlineAt: number
}

export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
  snapshot: string
}

export interface ContentDataSourceSiteDataResponse {
  key: string
  locale: string | null
  data: JsonValue | null
  updatedAt: number | null
}

export interface ContentDataSourceCapabilities {
  protocol: 'ginko-content-data-source/v1'
  query: {
    operators: readonly ProviderCapabilityOperator[]
    pagination: readonly ContentProviderPaginationMode[]
    maxPageSize: number
  }
}

export interface ContentDataSource<Context> {
  readonly name: string
  readonly capabilities: ContentDataSourceCapabilities
  query(
    context: Context,
    query: BoundedContentProviderQuery,
    control: ContentDataSourceControl,
  ): Promise<ContentDataSourceResult<ContentQueryResponse<ProviderDocumentInput>>>
  navigation?(
    context: Context,
    query: BoundedContentProviderQuery,
    options: { readonly limit: number },
    control: ContentDataSourceControl,
  ): Promise<ContentDataSourceResult<ContentProviderNavigationItem[]>>
  surroundings?(
    context: Context,
    collection: string,
    contentPath: string,
    options: ContentProviderSurroundingsOptions,
    control: ContentDataSourceControl,
  ): Promise<ContentDataSourceResult<Array<ContentProviderSurroundItem | null>>>
  search?(
    context: Context,
    request: ContentProviderSearchRequest & { limit: number },
    control: ContentDataSourceControl,
  ): Promise<ContentDataSourceResult<ContentProviderSearchResult[]>>
  siteData?(
    context: Context,
    request: ContentProviderSiteDataRequest,
    control: ContentDataSourceControl,
  ): Promise<ContentDataSourceResult<ContentDataSourceSiteDataResponse>>
  routes?(
    context: Context,
    request: { cursor: string | null; limit: number },
    control: ContentDataSourceControl,
  ): Promise<ContentDataSourceResult<CursorPage<ContentRouteRecord>>>
}
