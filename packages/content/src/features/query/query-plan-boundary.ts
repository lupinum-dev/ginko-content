import type {
  CanonicalQueryPlan,
  LoweredQueryPlan
} from '../../core/query/plan'
import { resolveLocaleChain } from '../../core/content/locale'
import type { ResolvedCollectionLocalePolicy } from '../localization/locale-policy'
import {
  lowerRouteToCandidates,
  mountProviderContentPath,
  unmountProviderContentPath
} from '../localization/route-projector'
import type {
  ContentProviderQueryPlan,
  ContentProviderVariantSelector
} from '../../public/provider-query'
import { ContentQueryInputError } from '../../core/query/lower'

const operationLocales = (
  selector: { locale?: string, fallback?: readonly string[], exact?: boolean },
  policy: ResolvedCollectionLocalePolicy
) => {
  const requestedLocale = selector.locale || policy.defaultLocale
  const localeChain = selector.exact
    ? (requestedLocale ? [requestedLocale] : [])
    : selector.fallback !== undefined
      ? [...new Set([requestedLocale, ...selector.fallback].filter(Boolean))]
      : resolveLocaleChain(requestedLocale, policy.defaultLocale, policy.fallback)
  return { requestedLocale, localeChain }
}

/**
 * A variant selector is the only part of a plan that needs collection route
 * policy, so `policy` is spelled `| undefined` rather than optional: a
 * variant-free plan and a cross-collection navigation plan genuinely have none
 * and must say so at the call site instead of omitting the argument.
 */
const requirePolicy = (
  policy: ResolvedCollectionLocalePolicy | undefined
): ResolvedCollectionLocalePolicy => {
  if (!policy) {
    throw new ContentQueryInputError(
      '$.resolveVariant',
      'Path, route, and reference selectors require a configured collection locale policy.'
    )
  }
  return policy
}

/** Resolve route/ref policy and produce the only plan shape accepted by the graph executor. */
export const toCanonicalQueryPlan = (
  plan: LoweredQueryPlan,
  policy: ResolvedCollectionLocalePolicy | undefined
): CanonicalQueryPlan => {
  const selector = plan.variant
  if (!selector) {
    const { variant: _variant, ...canonical } = plan
    return canonical
  }

  const resolvedPolicy = requirePolicy(policy)
  if (selector.by === 'path') {
    const { path, ...options } = selector
    return {
      ...plan,
      variant: {
        ...options,
        canonicalPath: path
      }
    }
  }
  // Only route and reference selectors consume the locale chain; a path
  // selector is already a concrete coordinate.
  const operation = operationLocales(selector, resolvedPolicy)
  if (selector.by === 'route') {
    return {
      ...plan,
      variant: {
        by: 'route',
        requestedRoute: selector.route,
        requestedLocale: operation.requestedLocale,
        candidates: lowerRouteToCandidates(selector.route, resolvedPolicy, operation)
          .map(candidate => ({
            locale: candidate.locale,
            canonicalPath: candidate.contentPath
          }))
      }
    }
  }
  return {
    ...plan,
    variant: {
      by: 'ref',
      requestedRef: selector.ref,
      requestedLocale: operation.requestedLocale,
      localeChain: operation.localeChain
    }
  }
}

/** Convert a closed canonical plan to the mounted provider wire exactly once. */
export const toContentProviderQueryPlan = (
  plan: CanonicalQueryPlan,
  policy: ResolvedCollectionLocalePolicy | undefined
): ContentProviderQueryPlan => {
  const selector = plan.variant
  if (!selector) {
    const { variant: _variant, ...provider } = plan
    return provider
  }

  const resolvedPolicy = requirePolicy(policy)
  let variant: ContentProviderVariantSelector
  if (selector.by === 'path') {
    const { canonicalPath, ...options } = selector
    const locale = selector.locale || resolvedPolicy.defaultLocale
    variant = {
      ...options,
      path: mountProviderContentPath({
        locale,
        contentPath: canonicalPath
      }, resolvedPolicy)
    }
  } else if (selector.by === 'route') {
    variant = {
      ...selector,
      candidates: selector.candidates.map(candidate => ({
        locale: candidate.locale,
        contentPath: mountProviderContentPath({
          locale: candidate.locale,
          contentPath: candidate.canonicalPath
        }, resolvedPolicy)
      }))
    }
  } else {
    variant = selector
  }

  return { ...plan, variant }
}

/** Filesystem-provider boundary: mounted public wire back to canonical graph coordinates. */
export const fromContentProviderQueryPlan = (
  plan: ContentProviderQueryPlan,
  policy: ResolvedCollectionLocalePolicy | undefined
): CanonicalQueryPlan => {
  const selector = plan.variant
  if (!selector) {
    const { variant: _variant, ...canonical } = plan
    return canonical
  }

  const resolvedPolicy = requirePolicy(policy)
  if (selector.by === 'path') {
    const operation = operationLocales(selector, resolvedPolicy)
    const { path, ...options } = selector
    return {
      ...plan,
      variant: {
        ...options,
        canonicalPath: unmountProviderContentPath(
          path,
          operation.requestedLocale,
          resolvedPolicy
        )
      }
    }
  }
  if (selector.by === 'route') {
    return {
      ...plan,
      variant: {
        ...selector,
        candidates: selector.candidates.map(candidate => ({
          locale: candidate.locale,
          canonicalPath: unmountProviderContentPath(
            candidate.contentPath,
            candidate.locale,
            resolvedPolicy
          )
        }))
      }
    }
  }
  return { ...plan, variant: selector }
}
