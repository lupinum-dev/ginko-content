/**
 * Provider wire contract v5.
 *
 * The single query envelope crossing the `ContentProvider` boundary. It wraps
 * a provider-coordinate plan rather than the graph executor's mount-agnostic
 * internal plan:
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
 * v5 is the prerelease hard cutover that gives collection identity one
 * authority on the envelope. It preserves
 * `$nin` as a native comparison node and retains the honest
 * `offset`/`cursor` pagination-mode union (`ContentProviderPaging`,
 * `ContentProviderListResponse`) and closes the route/ref selector
 * (`ContentProviderVariantSelector`) so providers never strip locale prefixes
 * or guess collection mounts themselves. There is no legacy dispatch — the
 * wire is v5 only.
 *
 * This module owns both the public wire types and their lowering helpers so
 * the provider boundary has one source of truth and no public-to-runtime
 * dependency cycle.
 */
import type { LoweredQueryPlan, QueryPlanBase } from '../core/query/plan'
import type { ContentQueryFindResponse } from '../types/api'
import type { ContentProviderQueryInput } from '../types/query'
import { ContentQueryInputError, lowerQueryPlan } from '../core/query/lower'

export type { ContentProviderQueryInput } from '../types/query'

export type {
  ContentQueryPagination,
  ContentProviderPaginationMode,
  ContentProviderPaging
} from '../core/query/plan'

export type ContentProviderVariantSelector =
  | ({
      readonly by: 'path'
      /** Mounted, locale-specific provider content path. */
      readonly path: string
      readonly locale?: string
      readonly fallback?: readonly string[]
      readonly exact?: boolean
    })
  | {
      readonly by: 'route'
      readonly requestedRoute: string
      readonly requestedLocale: string
      readonly candidates: readonly { readonly locale: string, readonly contentPath: string }[]
    }
  | {
      readonly by: 'ref'
      readonly requestedRef: string
      readonly requestedLocale: string
      readonly localeChain: readonly string[]
    }

export interface ContentProviderQueryPlan extends Omit<QueryPlanBase, 'collection'> {
  readonly variant?: ContentProviderVariantSelector
}

export interface ContentProviderPathResolutionInput {
  /** Mounted, locale-specific provider coordinate. */
  providerPath: string
  path?: never
  route?: never
  ref?: never
  locale?: string
  fallback?: string[] | false
  exact?: boolean
}

/** Input that can be closed without application route/locale policy. */
export type ContentProviderLoweringInput = Omit<ContentProviderQueryInput, 'resolveLocale' | 'resolveVariant'> & {
  resolveLocale?: {
    locale?: string
    fallback?: string[] | false
    exact?: boolean
  }
  resolveVariant?: ContentProviderPathResolutionInput
}

export type ContentProviderNavigationLoweringInput = ContentProviderLoweringInput & {
  collection: string
}

/**
 * Closed, discriminated list response for the provider `query` boundary — see
 * `ContentQueryFindResponse`. Re-exported under the
 * provider-wire name so provider authors do not need to reach into
 * `types/api`.
 */
export type ContentProviderListResponse<T> = ContentQueryFindResponse<T>

/** The single wire type crossing the provider `query`/`navigation` boundary. */
export interface ContentProviderQuery {
  /** Wire version — always `PROVIDER_QUERY_VERSION` (5). No legacy dispatch remains. */
  readonly v: 5
  /** `null` = cross-collection query (navigation / search aggregation paths). */
  readonly collection: string | null
  readonly plan: ContentProviderQueryPlan
}

export const PROVIDER_QUERY_VERSION = 5 as const

const lowerContextFreeInput = (params: ContentProviderLoweringInput): LoweredQueryPlan => {
  if ((params.resolveLocale as { fallback?: unknown } | undefined)?.fallback === true) {
    throw new ContentQueryInputError(
      '$.resolveLocale.fallback',
      'toContentProviderQuery() requires an explicit fallback locale chain.'
    )
  }
  const selector = params.resolveVariant
  if (!selector) return lowerQueryPlan(params)

  const allowedKeys = new Set(['providerPath', 'locale', 'fallback', 'exact'])
  const unknownKey = Object.keys(selector).find(key => !allowedKeys.has(key))
  if (
    unknownKey
    || typeof selector.providerPath !== 'string'
    || !selector.providerPath
    || (selector as { fallback?: unknown }).fallback === true
  ) {
    throw new ContentQueryInputError(
      '$.resolveVariant',
      'toContentProviderQuery() accepts only an explicit mounted providerPath selector.'
    )
  }

  return lowerQueryPlan({
    ...params,
    resolveVariant: {
      path: selector.providerPath,
      ...(selector.locale ? { locale: selector.locale } : {}),
      ...(selector.fallback !== undefined ? { fallback: selector.fallback } : {}),
      ...(selector.exact !== undefined ? { exact: selector.exact } : {})
    }
  })
}

const closeContextFreePlan = (plan: LoweredQueryPlan): ContentProviderQueryPlan => {
  const { collection: _collection, ...withoutCollection } = plan
  if (!plan.variant) {
    const { variant: _variant, ...closed } = withoutCollection
    return closed
  }
  if (plan.variant.by === 'path') {
    return { ...withoutCollection, variant: plan.variant }
  }
  throw new ContentQueryInputError(
    `$.resolveVariant.${plan.variant.by}`,
    'toContentProviderQuery() accepts only path variant selectors because route/ref selectors require application locale policy.'
  )
}

/** Lower the low-level input into the closed, JSON-pure provider wire envelope. */
export const toContentProviderQuery = (params: ContentProviderLoweringInput): ContentProviderQuery => ({
  v: PROVIDER_QUERY_VERSION,
  collection: params.collection ?? null,
  plan: closeContextFreePlan(lowerContextFreeInput(params))
})

/**
 * Lower navigation input into the same closed wire query providers execute.
 * This adds the required collection identity and otherwise uses the same
 * context-free lowering rules as `toContentProviderQuery()`.
 */
export const toContentProviderNavigationQuery = (
  params: ContentProviderNavigationLoweringInput
): ContentProviderQuery => toContentProviderQuery(params)
