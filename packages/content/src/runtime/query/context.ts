import type { NavItem } from '../../types/content'
import type { ContentQueryResponse } from '../../types/api'
import type { ContentQueryBuilderParams } from '../../types/query'

export interface RuntimeContentConfig {
  locales?: string[]
  defaultLocale?: string
  collections?: Record<string, {
    i18n?: boolean | { locales?: string[], defaultLocale?: string }
    route?: string | Record<string, string>
    references?: Record<string, string[]>
  }>
}

export type ContentQueryEndpoint = 'query' | 'navigation'

export interface ContentQueryContext {
  runtime: RuntimeContentConfig
  transport: <T>(
    endpoint: ContentQueryEndpoint,
    params: ContentQueryBuilderParams
  ) => Promise<ContentQueryResponse<T> | T | T[] | NavItem[] | null>
}
