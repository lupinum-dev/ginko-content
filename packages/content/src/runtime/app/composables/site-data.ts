import { withQuery } from 'ufo'
import { withContentBase, getContentApiFetcher, type ContentApiFetcher } from './utils'

export interface QuerySiteDataOptions {
  locale?: string
  fetcher?: ContentApiFetcher
}

export interface ContentSiteDataResponse<T = unknown> {
  key: string
  locale?: string
  data: T | null
  updatedAt?: number
}

export async function querySiteData<T = unknown> (
  key: string,
  options: QuerySiteDataOptions = {}
): Promise<ContentSiteDataResponse<T>> {
  const fetcher = getContentApiFetcher(options.fetcher)
  return await fetcher(withContentBase(withQuery('/site-data', {
    key,
    ...(options.locale ? { locale: options.locale } : {})
  })), {
    method: 'GET',
    responseType: 'json'
  }) as ContentSiteDataResponse<T>
}
