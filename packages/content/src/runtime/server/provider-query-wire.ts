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

export const PROVIDER_QUERY_VERSION = 2 as const

/**
 * Lower builder params into the wire envelope. This is the single place the
 * builder → plan translation happens before the provider boundary; providers
 * receive only the closed, JSON-pure plan. v2 only — no v1 dispatch remains.
 */
export const toContentProviderQuery = (params: ContentQueryBuilderParams): ContentProviderQuery => ({
  v: PROVIDER_QUERY_VERSION,
  collection: params.collection ?? null,
  plan: lowerQueryPlan(params)
})

/**
 * Split builder params into the final navigation wire pair. Selection is
 * lowered into the query plan; only normalized locale/fallback inputs travel
 * beside it. Providers return raw route facts, so there is no canonical-path
 * output mode at this boundary.
 */
export const toContentProviderNavigationQuery = (
  params: ContentQueryBuilderParams
): { query: ContentProviderQuery, options: ContentProviderNavigationOptions } => {
  const select = [
    ...(Array.isArray(params.only) ? params.only.map(String) : []),
    ...(Array.isArray(params.navigationFields) ? params.navigationFields.map(String) : [])
  ]
  const resolveLocale = params.resolveLocale

  const planParams: ContentQueryBuilderParams = {
    ...params,
    ...(select.length ? { only: [...new Set(select)] } : {})
  }
  delete planParams.navigationFields
  delete (planParams as { canonical?: boolean }).canonical

  return {
    query: toContentProviderQuery(planParams),
    options: {
      ...(resolveLocale?.locale ? { locale: resolveLocale.locale } : {}),
      ...(resolveLocale && 'fallback' in resolveLocale ? { fallback: resolveLocale.fallback } : {}),
      ...(resolveLocale?.exact === true ? { exact: true } : {})
    }
  }
}
