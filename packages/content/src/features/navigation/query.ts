import { buildLocaleFallbackChain } from '../../core/content/locale'
import { mergeCanonicalNavigation, type CanonicalNavigationItem } from './canonical'

/**
 * Navigation always derives fresh from `loadLocaleNavigation`: there is no persisted "single-entry" navigation cache here
 * (the deleted `_nav.json` artifact). `loadLocaleNavigation` itself reads
 * through `storage/graph.ts#getContentGraph`, which is already the one
 * process-cached graph in production and a per-request memo in dev, so
 * this layer does not need its own cache with no revision source.
 */
export interface ResolveNavigationRuntime {
  defaultLocale?: string
  localeFallback?: Record<string, string[]>
  navigation: false | { fields: string[] }
}

export interface ResolveNavigationRequest {
  locale?: string
  fallback?: boolean | readonly string[]
  exact?: boolean
}

export interface ResolveNavigationOptions {
  request?: ResolveNavigationRequest
  loadLocaleNavigation: (locale?: string) => Promise<CanonicalNavigationItem[]>
  resolveLocaleChain: (
    requestedLocale?: string,
    defaultLocale?: string,
    fallback?: Record<string, string[]>
  ) => string[]
}

export const resolveContentNavigationData = async (
  runtime: ResolveNavigationRuntime,
  {
    request = {},
    loadLocaleNavigation,
    resolveLocaleChain
  }: ResolveNavigationOptions
) => {
  if (runtime.navigation === false) {
    return []
  }

  const requestedLocale = request.locale
  const fallback = requestedLocale && request.fallback === true
    ? buildLocaleFallbackChain(requestedLocale, runtime.defaultLocale, runtime.localeFallback)
    : Array.isArray(request.fallback)
      ? Array.from(request.fallback)
      : []
  const resolvesLocale = Boolean(request.locale || request.fallback !== undefined || request.exact)
  const localeChain = resolvesLocale
    ? (request.exact || request.fallback === false
        ? [requestedLocale].filter(Boolean)
        : resolveLocaleChain(
            requestedLocale,
            runtime.defaultLocale,
            requestedLocale ? { [requestedLocale]: fallback } : {}
          ))
    : [requestedLocale].filter(Boolean)

  if (!localeChain.length) {
    return await loadLocaleNavigation(requestedLocale)
  }

  let mergedNavigation: CanonicalNavigationItem[] = []
  let first = true
  for (const locale of localeChain) {
    const navigation = await loadLocaleNavigation(locale)
    mergedNavigation = first ? navigation : mergeCanonicalNavigation(mergedNavigation, navigation)
    first = false
  }

  return mergedNavigation
}
