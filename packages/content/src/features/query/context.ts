import type { NavItem } from '../../types/content'
import type { ContentPublicQueryResponse } from '../../types/api'
import type { ContentProviderQueryInput } from '../../types/query'

export interface RuntimeContentConfig {
  locales?: string[]
  defaultLocale?: string
  localeFallback?: Record<string, string[]>
  collections?: Record<string, {
    i18n?: boolean | { locales?: string[], defaultLocale?: string }
    route?: string | Record<string, string>
    references?: Record<string, string[]>
  }>
}

export type ContentQueryEndpoint = 'query' | 'navigation'

export interface ContentQueryContext {
  runtime: RuntimeContentConfig
  /** Optional direct provider operation used by server-side `surround()`. */
  surroundings?: (
    collection: string,
    resolvedPath: string,
    options: {
      locale?: string
      resolvedLocale?: string
      fallback?: boolean | readonly string[]
      select?: readonly string[]
    }
  ) => Promise<Array<NavItem | null>>
  transport: <T>(
    endpoint: ContentQueryEndpoint,
    params: ContentProviderQueryInput
  ) => Promise<ContentPublicQueryResponse<T> | NavItem[]>
}
