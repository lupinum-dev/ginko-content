import type { NavItem } from '../../types/content'
import type { ContentQueryBuilderParams } from '../../types/query'
import { buildLocaleFallbackChain } from '../../core/content/locale'
import { mergeCanonicalNavigation, projectNavigationTree, type CanonicalNavigationItem } from './canonical'

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

export interface ResolveNavigationOptions {
  query?: ContentQueryBuilderParams
  loadLocaleNavigation: (locale?: string) => Promise<NavItem[]>
  resolveLocaleChain: (
    requestedLocale?: string,
    defaultLocale?: string,
    fallback?: Record<string, string[]>
  ) => string[]
  localizeNavigation?: (items: NavItem[], locale?: string, fallback?: string[], collection?: string, canonical?: boolean) => Promise<NavItem[]>
}

export const resolveContentNavigationData = async (
  runtime: ResolveNavigationRuntime,
  {
    query: inputQuery = {},
    loadLocaleNavigation,
    resolveLocaleChain,
    localizeNavigation
  }: ResolveNavigationOptions
) => {
  const query = { ...inputQuery }
  const resolveLocale = query.resolveLocale
  if (resolveLocale) {
    delete query.resolveLocale
  }
  const canonical = query.canonical === true
  if ('canonical' in query) {
    delete query.canonical
  }
  if ('navigationFields' in query) {
    delete query.navigationFields
  }

  if (runtime.navigation === false) {
    return []
  }

  const requestedLocale = resolveLocale?.locale
  const collection = typeof query.collection === 'string' ? query.collection : undefined
  const fallback = requestedLocale && resolveLocale?.fallback === true
    ? buildLocaleFallbackChain(requestedLocale, runtime.defaultLocale, runtime.localeFallback)
    : Array.isArray(resolveLocale?.fallback)
      ? resolveLocale.fallback
      : []
  const localeChain = resolveLocale
    ? (resolveLocale.exact || resolveLocale.fallback === false
        ? [requestedLocale].filter(Boolean)
        : resolveLocaleChain(
            requestedLocale,
            runtime.defaultLocale,
            requestedLocale ? { [requestedLocale]: fallback } : {}
          ))
    : [requestedLocale].filter(Boolean)

  if (!localeChain.length) {
    const navigation = await loadLocaleNavigation(requestedLocale)
    return localizeNavigation
      ? await localizeNavigation(navigation, requestedLocale, [], collection, canonical)
      : projectNavigationTree(navigation as CanonicalNavigationItem[], { locale: requestedLocale, defaultLocale: runtime.defaultLocale, collection, canonical }) as NavItem[]
  }

  let mergedNavigation: NavItem[] = []
  let first = true
  for (const locale of localeChain) {
    const navigation = await loadLocaleNavigation(locale)
    mergedNavigation = first ? navigation : mergeCanonicalNavigation(mergedNavigation as CanonicalNavigationItem[], navigation as CanonicalNavigationItem[]) as NavItem[]
    first = false
  }

  return localizeNavigation
    ? await localizeNavigation(mergedNavigation, requestedLocale, fallback, collection, canonical)
    : projectNavigationTree(mergedNavigation as CanonicalNavigationItem[], { locale: requestedLocale, defaultLocale: runtime.defaultLocale, collection, canonical }) as NavItem[]
}
