import type { H3Event } from 'h3'
import type {
  ContentProvider,
  ContentProviderResult,
  MaybeContentProviderResult
} from '../../public/provider'
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

const wrapProviderMethod = <T extends ProviderMethod>(event: H3Event, method: T): T => {
  return (async (...args: Parameters<T>) =>
    unwrapContentProviderResult(event, await method(...args))) as T
}

/**
 * External providers may return `{ data, cache }` from any provider method.
 * Runtime consumers should continue receiving the historical raw data shape,
 * while the request-local cache collector records the cache hint.
 */
export const wrapContentProviderCacheResults = (event: H3Event, provider: ContentProvider): ContentProvider => {
  const wrapped: ContentProvider = {
    ...provider,
    query: wrapProviderMethod(event, provider.query)
  }

  if (provider.navigationQuery) wrapped.navigationQuery = wrapProviderMethod(event, provider.navigationQuery)
  if (provider.navigation) wrapped.navigation = wrapProviderMethod(event, provider.navigation)
  if (provider.surroundings) wrapped.surroundings = wrapProviderMethod(event, provider.surroundings)
  if (provider.searchSections) wrapped.searchSections = wrapProviderMethod(event, provider.searchSections)
  if (provider.search) wrapped.search = wrapProviderMethod(event, provider.search)
  if (provider.siteData) wrapped.siteData = wrapProviderMethod(event, provider.siteData)
  if (provider.page) wrapped.page = wrapProviderMethod(event, provider.page)
  if (provider.routeMeta) wrapped.routeMeta = wrapProviderMethod(event, provider.routeMeta)
  if (provider.sitemapEntries) wrapped.sitemapEntries = wrapProviderMethod(event, provider.sitemapEntries)

  return wrapped
}
