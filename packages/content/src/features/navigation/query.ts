import type { NavItem } from '../../types/content'
import type { ContentQueryBuilderParams } from '../../types/query'
import { buildLocaleFallbackChain } from '../../core/content/locale'
import { mergeCanonicalNavigation, projectNavigationTree, type CanonicalNavigationItem } from './canonical'

export interface ResolveNavigationRuntime {
  defaultLocale?: string
  localeFallback?: Record<string, string[]>
  navigation: false | { fields: string[] }
  cacheEnabled: boolean
  isPreview: boolean
}

export interface ResolveNavigationOptions {
  query?: ContentQueryBuilderParams
  readCache?: () => Promise<NavItem[] | null>
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
    readCache,
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

  if (runtime.cacheEnabled && !runtime.isPreview && !resolveLocale && Object.keys(query).length === 0 && readCache) {
    const cache = await readCache()
    if (cache) {
      return cache
    }
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
