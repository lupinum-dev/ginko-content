import type { H3Event } from 'h3'
import type { ContentQueryResponse } from '../../types/api'
import type { ParsedContent } from '../../types/content'
import type {
  ContentProvider,
  ContentProviderNavigationItem,
  ContentProviderNavigationOptions,
  ContentProviderQuery,
  ContentProviderSearchResult,
  ContentProviderSiteDataRequest,
  ContentProviderSiteDataResponse,
  ContentProviderSurroundItem,
  ContentProviderSurroundingsOptions,
  ContentRouteRecord,
  MaybeContentProviderResult
} from '../../public/provider'
import type { ContentProviderSearchRequest } from '../../types/search'
import { isContentProviderResult } from '../../public/provider'
import { collectContentCacheHint } from './cache-hints'

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

export interface RuntimeContentProvider extends Omit<ContentProvider, 'query' | 'navigation' | 'surroundings' | 'search' | 'siteData' | 'routes'> {
  query: <T = ParsedContent>(event: H3Event, query: ContentProviderQuery) => Promise<ContentQueryResponse<T>>
  navigation?: (event: H3Event, query: ContentProviderQuery, options?: ContentProviderNavigationOptions) => Promise<ContentProviderNavigationItem[]>
  surroundings?: (event: H3Event, collection: string, contentPath: string, options?: ContentProviderSurroundingsOptions) => Promise<Array<ContentProviderSurroundItem | null>>
  search?: (event: H3Event, request: ContentProviderSearchRequest) => Promise<ContentProviderSearchResult[]>
  siteData?: <T = unknown>(event: H3Event, request: ContentProviderSiteDataRequest) => Promise<ContentProviderSiteDataResponse<T>>
  routes?: (event: H3Event) => Promise<ContentRouteRecord[]>
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

  if (provider.navigation) wrapped.navigation = wrapProviderMethod(event, provider.navigation)
  if (provider.surroundings) wrapped.surroundings = wrapProviderMethod(event, provider.surroundings)
  if (provider.search) wrapped.search = wrapProviderMethod(event, provider.search)
  if (provider.siteData) wrapped.siteData = wrapProviderMethod(event, provider.siteData) as RuntimeContentProvider['siteData']
  if (provider.routes) wrapped.routes = wrapProviderMethod(event, provider.routes)

  return wrapped
}
