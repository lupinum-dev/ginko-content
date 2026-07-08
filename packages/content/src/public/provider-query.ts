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
 *    functions (regex operands are lowered to `{ source, flags }`), so the
 *    whole envelope survives `JSON.parse(JSON.stringify(query))`. The provider
 *    registry asserts this in dev.
 *
 * Providers pattern-match `plan.filter` (a `FilterExpr` tree); they never
 * parse builder params again.
 */
import type { ContentQueryBuilderParams } from '../types/query'
import type { ContentQueryPlan } from '../core/query/plan'
import { lowerQueryPlan } from '../core/query/lower'

export const PROVIDER_QUERY_VERSION = 1 as const

/** The single wire type crossing the provider `query`/`navigationQuery` boundary. */
export interface ContentProviderQuery {
  v: typeof PROVIDER_QUERY_VERSION
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

/**
 * Lower builder params into the wire envelope. This is the single place the
 * builder → plan translation happens before the provider boundary; providers
 * receive only the closed, JSON-pure plan.
 */
export const toContentProviderQuery = (params: ContentQueryBuilderParams): ContentProviderQuery => ({
  v: PROVIDER_QUERY_VERSION,
  collection: params.collection ?? null,
  plan: lowerQueryPlan(params)
})

/**
 * Split builder params into the navigation wire pair (CS-5): the query plan
 * (collection + user filter/sort) plus the navigation-only options
 * (`fields` = `only` ∪ `navigationFields`, `canonical`, and the raw
 * `resolveLocale`). The nav-only keys are stripped before lowering so they do
 * not leak into the plan. Pure — the single navigation builder-params → wire
 * seam, usable by providers and their conformance suites.
 */
export const toContentProviderNavigationQuery = (
  params: ContentQueryBuilderParams
): { query: ContentProviderQuery, options: ContentProviderNavigationOptions } => {
  const fields = [
    ...(Array.isArray(params.only) ? params.only.map(String) : []),
    ...(Array.isArray(params.navigationFields) ? params.navigationFields.map(String) : [])
  ]
  const canonical = params.canonical === true
  const resolveLocale = params.resolveLocale

  // `resolveLocale` stays in the plan (lowered) so providers that execute the
  // plan directly still resolve locale variants; it is ALSO surfaced raw in the
  // options because navigation pipelines that walk the fallback chain need the
  // un-normalized `fallback: true|false` distinction the plan erases.
  const planParams: ContentQueryBuilderParams = { ...params }
  delete planParams.only
  delete planParams.navigationFields
  delete (planParams as { canonical?: boolean }).canonical

  return {
    query: toContentProviderQuery(planParams),
    options: {
      ...(fields.length ? { fields } : {}),
      ...(canonical ? { canonical: true } : {}),
      ...(resolveLocale ? { resolveLocale } : {})
    }
  }
}
