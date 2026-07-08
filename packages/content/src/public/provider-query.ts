/**
 * Provider wire contract v1 (CS-5).
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
 * The builder-params → wire lowering helpers (`toContentProviderQuery`,
 * `toContentProviderNavigationQuery`, `PROVIDER_QUERY_VERSION`) live in the
 * runtime adapter layer (`../runtime/server/provider-query-wire`) so the
 * internal query IR is not named in the public facade; they are re-exported
 * here to keep the exported surface stable.
 */
import type { ContentQueryPlan } from '../core/query/plan'

export type { ContentQueryPlan } from '../core/query/plan'

export {
  PROVIDER_QUERY_VERSION,
  toContentProviderQuery,
  toContentProviderNavigationQuery
} from '../runtime/server/provider-query-wire'

/** The single wire type crossing the provider `query`/`navigationQuery` boundary. */
export interface ContentProviderQuery {
  /** Wire version — always `PROVIDER_QUERY_VERSION` (1). */
  v: 1
  /** `null` = cross-collection query (navigation / search aggregation paths). */
  collection: string | null
  plan: ContentQueryPlan
}

/**
 * Navigation-only knobs that are NOT part of the query plan. Navigation adds
 * projection fields, a canonical-vs-localized routing flag, and a locale
 * resolution spec — all of which configure `navigationQuery` tree shaping
 * rather than document selection, so they travel beside the plan instead of
 * being smuggled through it.
 *
 * `resolveLocale` is carried here in its un-lowered builder shape because
 * navigation walks the fallback chain itself and must distinguish
 * `fallback: true` (expand from config) / `false` (exact) / an explicit chain —
 * a distinction the executor plan intentionally normalizes away.
 */
export interface ContentProviderNavigationOptions {
  /** Extra fields the navigation tree should carry beyond the defaults. */
  fields?: string[]
  /** Emit canonical (locale-agnostic) routes instead of localized ones. */
  canonical?: boolean
  /** Locale resolution for the navigation tree, in builder shape. */
  resolveLocale?: {
    locale?: string
    fallback?: boolean | string[]
    exact?: boolean
  }
}
