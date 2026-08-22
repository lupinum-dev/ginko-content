import type { NavItem } from '../../types/content'
import type { ContentPublicQueryResponse } from '../../types/api'
import type { ContentQueryTransportInput } from '../../types/query'
import type { ResolvedCollectionLocalePolicy } from '../localization/locale-policy'

export interface RuntimeContentConfig {
  locales?: string[]
  defaultLocale?: string
  localeFallback?: Record<string, string[]>
  collections?: Record<string, {
    i18n?: boolean | { locales?: string[], defaultLocale?: string }
    localePolicy?: ResolvedCollectionLocalePolicy
    route?: string | Record<string, string>
    references?: Record<string, string[]>
  }>
}

export type ContentQueryEndpoint = 'query' | 'navigation'

/**
 * Internal execution context created only by Ginko's client and server
 * adapters. Query transports must consume orchestration fields such as
 * `populate` and return the fully resolved public response envelope.
 */
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
  /** Execute the complete public query contract, including population. */
  transport: <T>(
    endpoint: ContentQueryEndpoint,
    params: ContentQueryTransportInput
  ) => Promise<ContentPublicQueryResponse<T> | NavItem[]>
}
