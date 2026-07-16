/**
 * Provider wire contract v2 (CS-5).
 *
 * The single query envelope crossing the `ContentProvider` boundary. It wraps
 * the executor-facing `ContentQueryPlan` (see `../core/query/plan.ts`) rather
 * than the open-ended builder params that used to leak across the seam:
 *
 *  - **closed** — no index signatures; every field is named.
 *  - **versioned** — `v` lets providers reject a wire they do not understand.
 *  - **JSON-pure** — the plan carries no `RegExp` instances, `Date`s, or
 *    functions (regex operands are lowered to a tagged JSON object), so the
 *    whole envelope survives `JSON.parse(JSON.stringify(query))`. The provider
 *    registry asserts this in dev.
 *
 * Providers pattern-match `plan.filter` (a `FilterExpr` tree); they never
 * parse builder params again.
 *
 * v2 replaces boolean `limit`/`skip`/`count` capabilities with the honest
 * `offset`/`cursor` pagination-mode union (`ContentProviderPaging`,
 * `ContentProviderListResponse`) and closes the route/ref selector
 * (`ContentProviderVariantSelector`) so providers never strip locale prefixes
 * or guess collection mounts themselves. There is no v1 dispatch — the wire
 * is v2 only.
 *
 * The builder-params → wire lowering helpers (`toContentProviderQuery`,
 * `toContentProviderNavigationQuery`, `PROVIDER_QUERY_VERSION`) live in the
 * runtime adapter layer (`../runtime/server/provider-query-wire`) so the
 * internal query IR is not named in the public facade; they are re-exported
 * here to keep the exported surface stable.
 */
import type { ContentQueryPlan } from '../core/query/plan'
import type { ContentQueryFindResponse } from '../types/api'

export type {
  ContentQueryPlan,
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

export {
  PROVIDER_QUERY_VERSION,
  toContentProviderQuery,
  toContentProviderNavigationQuery
} from '../runtime/server/provider-query-wire'

/** The single wire type crossing the provider `query`/`navigation` boundary. */
export interface ContentProviderQuery {
  /** Wire version — always `PROVIDER_QUERY_VERSION` (2). No v1 dispatch remains. */
  v: 2
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
