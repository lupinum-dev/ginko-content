/**
 * Builder-params → provider-wire lowering seam.
 *
 * These helpers translate the internal query IR (`ContentQueryBuilderParams`,
 * see `../../types/query-parts/transport.ts`) into the closed, JSON-pure
 * `ContentProviderQuery` wire envelope. They live in the runtime adapter layer
 * — NOT in the `public/` facade — because the IR is internal plumbing: keeping
 * its name out of `src/public/` is what makes the IR "not public" while the
 * lowering functions themselves stay part of the exported surface (re-exported
 * from `../../public/provider-query`).
 */
import type { ContentQueryBuilderParams } from '../../types/query'
import type { ContentProviderNavigationOptions, ContentProviderQuery } from '../../public/provider-query'
import { lowerQueryPlan } from '../../core/query/lower'

export const PROVIDER_QUERY_VERSION = 1 as const

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
