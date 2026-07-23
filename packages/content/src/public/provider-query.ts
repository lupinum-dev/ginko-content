/**
 * Provider wire contract v3.
 *
 * The single query envelope crossing the `ContentProvider` boundary. It wraps
 * the executor-facing `ContentQueryPlan` (see `../core/query/plan.ts`) rather
 * than the low-level provider/compiler input:
 *
 *  - **closed** — no index signatures; every field is named.
 *  - **versioned** — `v` lets providers reject a wire they do not understand.
 *  - **JSON-pure** — the plan carries no `RegExp` instances, `Date`s, or
 *    functions (regex operands are lowered to a tagged JSON object), so the
 *    whole envelope survives `JSON.parse(JSON.stringify(query))`. The provider
 *    registry asserts this before provider dispatch.
 *
 * Providers pattern-match `plan.filter` (a `FilterExpr` tree); they never
 * parse the low-level input again.
 *
 * v3 is the prerelease hard cutover for the closed plan contract. It preserves
 * `$nin` as a native comparison node and retains the honest
 * `offset`/`cursor` pagination-mode union (`ContentProviderPaging`,
 * `ContentProviderListResponse`) and closes the route/ref selector
 * (`ContentProviderVariantSelector`) so providers never strip locale prefixes
 * or guess collection mounts themselves. There is no legacy dispatch — the
 * wire is v3 only.
 *
 * This module owns both the public wire types and their lowering helpers so
 * the provider boundary has one source of truth and no public-to-runtime
 * dependency cycle.
 */
import type { ContentQueryPlan } from '../core/query/plan'
import type { ContentQueryFindResponse } from '../types/api'
import type { ContentProviderQueryInput } from '../types/query'
import { lowerQueryPlan } from '../core/query/lower'

export type { ContentProviderQueryInput } from '../types/query'

export type {
  ContentQueryPlan,
  ContentQueryPagination,
  ContentQueryVariant,
  ContentProviderPaginationMode,
  ContentProviderPaging,
  ContentProviderVariantSelector
} from '../core/query/plan'

/**
 * Closed, discriminated list response for the provider `query` boundary — see
 * `ContentQueryFindResponse`. Re-exported under the
 * provider-wire name so provider authors do not need to reach into
 * `types/api`.
 */
export type ContentProviderListResponse<T> = ContentQueryFindResponse<T>

/** The single wire type crossing the provider `query`/`navigation` boundary. */
export interface ContentProviderQuery {
  /** Wire version — always `PROVIDER_QUERY_VERSION` (3). No legacy dispatch remains. */
  v: 3
  /** `null` = cross-collection query (navigation / search aggregation paths). */
  collection: string | null
  plan: ContentQueryPlan
}

/**
 * Locale/fallback facts needed while a provider builds a navigation tree.
 * Selection already lives in the versioned query plan; providers return raw
 * route facts, so there is no second `fields` or `canonical` projection knob.
 */
export interface ContentProviderNavigationOptions {
  locale?: string
  fallback?: boolean | readonly string[]
  exact?: boolean
}

export const PROVIDER_QUERY_VERSION = 3 as const

/** Lower the low-level input into the closed, JSON-pure provider wire envelope. */
export const toContentProviderQuery = (params: ContentProviderQueryInput): ContentProviderQuery => ({
  v: PROVIDER_QUERY_VERSION,
  collection: params.collection ?? null,
  plan: lowerQueryPlan(params)
})

/**
 * Split the low-level input into the final navigation wire pair. Selection is
 * lowered into the query plan; only normalized locale inputs travel beside
 * it because providers return raw route facts.
 */
export const toContentProviderNavigationQuery = (
  params: ContentProviderQueryInput
): { query: ContentProviderQuery, options: ContentProviderNavigationOptions } => {
  const resolveLocale = params.resolveLocale

  return {
    query: toContentProviderQuery(params),
    options: {
      ...(resolveLocale?.locale ? { locale: resolveLocale.locale } : {}),
      ...(resolveLocale && 'fallback' in resolveLocale ? { fallback: resolveLocale.fallback } : {}),
      ...(resolveLocale?.exact === true ? { exact: true } : {})
    }
  }
}
