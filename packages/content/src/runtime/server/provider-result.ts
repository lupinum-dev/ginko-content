import type { H3Event } from 'h3'
import type { ContentQueryResponse } from '../../types/api'
import type { NavItem, ParsedContent } from '../../types/content'
import type {
  ContentCollectionItemSurroundingsOptions,
  ContentCollectionNavigationOptions,
  ContentCollectionPageOptions,
  ContentCollectionRouteMetaOptions,
  ContentCollectionSearchSectionsOptions,
  ContentPageResult,
  ContentQueryBuilderParams,
  ContentRouteMeta,
  ContentSearchSection,
  ContentSitemapEntry
} from '../../types/query'
import type { QueryCollectionsSitemapEntriesOptions } from '../../features/sitemap/query'
import type {
  ContentProvider,
  ContentProviderResult,
  ContentProviderSiteDataRequest,
  ContentProviderSiteDataResponse,
  MaybeContentProviderResult
} from '../../public/provider'
import type { ContentProviderSearchRequest, ContentSearchResult } from '../../types/search'
import { contentProviderResultMarker } from '../../public/provider'
import { collectContentCacheHint } from './cache-hints'

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const isContentProviderResult = <T = unknown>(value: unknown): value is ContentProviderResult<T> =>
  isObject(value) && value[contentProviderResultMarker] === true

export const unwrapContentProviderResult = <T>(
  event: H3Event,
  result: MaybeContentProviderResult<T>
): T => {
  if (isContentProviderResult<T>(result)) {
    collectContentCacheHint(event, result.cache)
    return result.data
  }

  return result
}

type ProviderMethod = (...args: any[]) => Promise<any>

type UnwrappedProviderMethod<T extends ProviderMethod> = (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>> extends MaybeContentProviderResult<infer R> ? R : Awaited<ReturnType<T>>>

const wrapProviderMethod = <T extends ProviderMethod>(event: H3Event, method: T): UnwrappedProviderMethod<T> => {
  return (async (...args: Parameters<T>) =>
    unwrapContentProviderResult(event, await method(...args))) as UnwrappedProviderMethod<T>
}

export interface RuntimeContentProvider extends Omit<ContentProvider, 'query' | 'navigationQuery' | 'navigation' | 'surroundings' | 'searchSections' | 'search' | 'siteData' | 'page' | 'routeMeta' | 'sitemapEntries'> {
  query: <T = ParsedContent>(event: H3Event, query: ContentQueryBuilderParams) => Promise<ContentQueryResponse<T> | T[] | T | number | undefined>
  navigationQuery?: (event: H3Event, query: ContentQueryBuilderParams) => Promise<NavItem[]>
  navigation?: (event: H3Event, collection: string, options?: string[] | ContentCollectionNavigationOptions) => Promise<NavItem[]>
  surroundings?: (event: H3Event, collection: string, path: string, options?: ContentCollectionItemSurroundingsOptions) => Promise<Array<NavItem | null>>
  searchSections?: (event: H3Event, collection: string, options?: ContentCollectionSearchSectionsOptions) => Promise<ContentSearchSection[]>
  search?: (event: H3Event, request: ContentProviderSearchRequest) => Promise<ContentSearchResult[]>
  siteData?: <T = unknown>(event: H3Event, request: ContentProviderSiteDataRequest) => Promise<ContentProviderSiteDataResponse<T>>
  page?: <T = ParsedContent>(event: H3Event, collection: string, routeOrPath?: string, options?: ContentCollectionPageOptions) => Promise<ContentPageResult<T> | null>
  routeMeta?: (event: H3Event, collection: string, routeOrPath?: string, options?: ContentCollectionRouteMetaOptions) => Promise<ContentRouteMeta | null>
  sitemapEntries?: (event: H3Event, options?: QueryCollectionsSitemapEntriesOptions) => Promise<ContentSitemapEntry[]>
}

/**
 * External providers may return `{ data, cache }` from any provider method.
 * Runtime consumers should continue receiving the historical raw data shape,
 * while the request-local cache collector records the cache hint.
 */
export const wrapContentProviderCacheResults = (event: H3Event, provider: ContentProvider): RuntimeContentProvider => {
  const wrapped = {
    ...provider,
    query: wrapProviderMethod(event, provider.query)
  } as RuntimeContentProvider

  if (provider.navigationQuery) wrapped.navigationQuery = wrapProviderMethod(event, provider.navigationQuery)
  if (provider.navigation) wrapped.navigation = wrapProviderMethod(event, provider.navigation)
  if (provider.surroundings) wrapped.surroundings = wrapProviderMethod(event, provider.surroundings)
  if (provider.searchSections) wrapped.searchSections = wrapProviderMethod(event, provider.searchSections)
  if (provider.search) wrapped.search = wrapProviderMethod(event, provider.search)
  if (provider.siteData) wrapped.siteData = wrapProviderMethod(event, provider.siteData) as RuntimeContentProvider['siteData']
  if (provider.page) wrapped.page = wrapProviderMethod(event, provider.page) as RuntimeContentProvider['page']
  if (provider.routeMeta) wrapped.routeMeta = wrapProviderMethod(event, provider.routeMeta)
  if (provider.sitemapEntries) wrapped.sitemapEntries = wrapProviderMethod(event, provider.sitemapEntries)

  return wrapped
}
