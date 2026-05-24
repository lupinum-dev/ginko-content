import type { NavItem } from '../../../types/content'
import type { ContentQueryRequest } from '../../../types/query'
import { fetchContentApi, getContentApiFetcher } from './utils'

export const fetchNavigationPayload = async (queryBuilder: ContentQueryRequest): Promise<Array<NavItem>> => {
  const params = queryBuilder.params()

  return await fetchContentApi<NavItem[]>('navigation', params, {
    fetcher: getContentApiFetcher()
  })
}
