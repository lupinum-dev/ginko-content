import type { ContentNavigationItem, ParsedContent } from '../../types/content'
import type { ContentLocaleEntry, ContentPageResult, ContentRouteMeta, LocalePathEntry } from '../../types/query'
import type { SearchSection } from '../search/sections'
import { localizeLinkProps } from './links'
import { getContentStem, localizePath, normalizeContentPath, projectContentPathToLocale, type RouteMounts } from './path'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const createLocaleVariants = (
  variants: Record<string, string> | ContentLocaleEntry[] | undefined,
  defaultLocale?: string,
  routeMounts?: RouteMounts
) => {
  if (!variants) {
    return []
  }

  const entries = Array.isArray(variants)
    ? variants
    : Object.entries(variants).map(([locale, path]) => ({
        canonicalKey: path,
        locale,
        path
      }))

  return entries
    .filter(entry => entry.path)
    .map(entry => ({
      locale: entry.locale,
      canonicalPath: normalizeContentPath(entry.path || '/'),
      path: projectContentPathToLocale(entry.path || '/', entry.locale, defaultLocale, routeMounts)
    }))
}

/**
 * Build the per-locale path map attached to localized documents.
 *
 * `variants` here only enumerates locales that actually have a concrete
 * variant — `translated` is therefore always `true` in this map. When a
 * caller (e.g. `localizePageResultWithFallbacks`) wants to expose every
 * configured locale (including ones backed by fallback), it should fill in
 * the missing entries with `{ path: <fallback path>, translated: false, fallback }`.
 */
export const createLocalePaths = (
  variants: ReturnType<typeof createLocaleVariants>
): Record<string, LocalePathEntry> => {
  return Object.fromEntries(
    variants.map(variant => [variant.locale, { path: variant.path, translated: true } satisfies LocalePathEntry])
  )
}

/**
 * Decorate a `localePaths` map so every configured locale has an entry. Any
 * locale missing a concrete variant is back-filled with the fallback locale's
 * path and `translated: false`.
 */
export const decorateLocalePathsWithFallbacks = (
  localePaths: Record<string, LocalePathEntry>,
  configuredLocales: string[],
  fallbackLocale?: string,
  defaultLocale?: string,
  routeMounts?: RouteMounts
): Record<string, LocalePathEntry> => {
  if (!configuredLocales.length) {
    return localePaths
  }
  const result: Record<string, LocalePathEntry> = { ...localePaths }
  const fallbackPath = fallbackLocale ? localePaths[fallbackLocale]?.path : undefined
  for (const locale of configuredLocales) {
    if (result[locale]) continue
    if (fallbackLocale && fallbackPath) {
      result[locale] = {
        path: projectContentPathToLocale(fallbackPath, locale, defaultLocale, routeMounts),
        translated: false,
        fallback: fallbackLocale
      }
    }
  }
  return result
}

/**
 * Shape a parsed page into the `ContentPageResult` used by current route
 * helpers: locale-prefixed route path, variants,
 * localePaths, and localized top-level link metadata. The page body is never
 * mutated.
 */
export const localizePageResult = <T extends ParsedContent & Record<string, unknown>>(
  page: T,
  locale?: string,
  defaultLocale?: string,
  locales: string[] = [],
  routeMounts?: RouteMounts
): ContentPageResult<T> => {
  const resolution = page.resolved
  const canonicalPath = normalizeContentPath(page.path || '/')
  const variants = createLocaleVariants(resolution?.variantPaths, defaultLocale, routeMounts)
  const path = projectContentPathToLocale(canonicalPath, locale || resolution?.locale || page.locale, defaultLocale, routeMounts)
  const resolvedLocale = resolution?.locale || page.locale || locale || defaultLocale || ''
  const requestedLocale = resolution?.requestedLocale || locale
  const fallback = Boolean(resolution?.fallback || (requestedLocale && resolvedLocale && requestedLocale !== resolvedLocale))
  const result = {
    ...page,
    path,
    canonicalPath,
    locale: locale || resolution?.locale || page.locale || defaultLocale || '',
    defaultLocale: defaultLocale || '',
    variants,
    localePaths: createLocalePaths(variants),
    resolved: {
      locale: resolvedLocale,
      ...(requestedLocale ? { requestedLocale } : {}),
      fallback,
      ...(fallback ? { fallbackLocale: resolvedLocale } : {}),
      path,
      ...(resolution?.requestedPath ? { requestedPath: resolution.requestedPath } : {}),
      ...(resolution?.requestedRoute ? { requestedRoute: resolution.requestedRoute } : {}),
      ...(resolution?.requestedRef ? { requestedRef: resolution.requestedRef } : {}),
      availableLocales: resolution?.availableLocales || Object.keys(resolution?.variantPaths || {}),
      ...(resolution?.resolvedRefs ? { resolvedRefs: resolution.resolvedRefs } : {})
    },
    stem: getContentStem(canonicalPath, page.file?.path),
    extension: page.file?.extension
  } as ContentPageResult<T>

  const links = (result as ContentPageResult<T> & { links?: unknown }).links
  if (Array.isArray(links)) {
    ;(result as ContentPageResult<T> & { links: unknown[] }).links = links.map((link) => {
      if (!isRecord(link)) {
        return link
      }

      const localizedLink = structuredClone(link) as Record<string, unknown>
      localizeLinkProps(localizedLink, locale, defaultLocale, locales)
      return localizedLink
    })
  }

  return result
}

const localizeNavigationItem = (
  item: ContentNavigationItem,
  locale?: string,
  defaultLocale?: string,
  locales: string[] = [],
  routeMounts?: RouteMounts
): ContentNavigationItem => {
  const rawPath = typeof item.canonicalPath === 'string'
    ? item.canonicalPath
    : typeof item.path === 'string'
      ? item.path
      : undefined
  if (!rawPath) {
    return {
      ...item,
      children: item.children?.map(child => localizeNavigationItem(child, locale, defaultLocale, locales, routeMounts))
    }
  }

  const canonicalPath = normalizeContentPath(rawPath)
  const localizedPath = projectContentPathToLocale(canonicalPath, locale, defaultLocale, routeMounts)
  const file = (item.file as { path?: string } | undefined)?.path
  return {
    ...item,
    path: localizedPath,
    canonicalPath,
    stem: item.stem || getContentStem(canonicalPath, file),
    children: item.children?.map(child => localizeNavigationItem(child, locale, defaultLocale, locales, routeMounts))
  }
}

export const localizeNavigation = (
  navigation: ContentNavigationItem[] = [],
  locale?: string,
  defaultLocale?: string,
  locales: string[] = [],
  routeMounts?: RouteMounts
) => navigation.map(item => localizeNavigationItem(item, locale, defaultLocale, locales, routeMounts))

export const localizeSurround = <T extends Record<string, unknown>>(
  items: Array<T | null> = [],
  locale?: string,
  defaultLocale?: string,
  _locales: string[] = [],
  routeMounts?: RouteMounts
) => items.map((item) => {
  if (!item) {
    return item
  }

  const canonicalPath = normalizeContentPath(String(item.canonicalPath || item.path || '/'))
  return {
    ...item,
    path: projectContentPathToLocale(canonicalPath, locale, defaultLocale, routeMounts),
    canonicalPath,
    stem: item.stem || getContentStem(canonicalPath, (item.file as { path?: string } | undefined)?.path)
  }
}) as Array<T | null>

export const localizeSearchSections = (
  sections: SearchSection[] = [],
  locale?: string,
  defaultLocale?: string,
  locales: string[] = []
) => sections.map(section => ({
  ...section,
  id: localizePath(section.id, locale, defaultLocale, locales) || section.id
}))

export const createRouteMeta = <T extends ParsedContent & Record<string, unknown>>(
  page: T,
  locale?: string,
  defaultLocale?: string,
  routeMounts?: RouteMounts
): ContentRouteMeta => {
  const resolution = page.resolved
  const canonicalPath = normalizeContentPath(page.path || '/')
  const resolvedLocale = resolution?.locale || page.locale || locale || defaultLocale || ''
  const requestedLocale = resolution?.requestedLocale || locale
  const fallback = Boolean(resolution?.fallback || (requestedLocale && resolvedLocale && requestedLocale !== resolvedLocale))
  // When re-shaping an already-localized page (e.g. route-meta over a page
  // result), the raw variant-path map has been folded into the finalized
  // `resolved` envelope and is no longer present; fall back to the variants the
  // first shaping already produced.
  const variants = resolution?.variantPaths
    ? createLocaleVariants(resolution.variantPaths, defaultLocale, routeMounts)
    : (Array.isArray((page as { variants?: unknown }).variants)
        ? ((page as unknown as { variants: ReturnType<typeof createLocaleVariants> }).variants)
        : [])
  const path = projectContentPathToLocale(canonicalPath, locale || resolvedLocale, defaultLocale, routeMounts)

  return {
    locale: locale || resolvedLocale,
    defaultLocale: defaultLocale || '',
    path,
    canonicalPath,
    variants,
    localePaths: createLocalePaths(variants),
    resolved: {
      locale: resolvedLocale,
      ...(requestedLocale ? { requestedLocale } : {}),
      fallback,
      ...(fallback ? { fallbackLocale: resolvedLocale } : {}),
      path,
      ...(resolution?.requestedPath ? { requestedPath: resolution.requestedPath } : {}),
      ...(resolution?.requestedRoute ? { requestedRoute: resolution.requestedRoute } : {}),
      ...(resolution?.requestedRef ? { requestedRef: resolution.requestedRef } : {}),
      availableLocales: resolution?.availableLocales || Object.keys(resolution?.variantPaths || {}),
      ...(resolution?.resolvedRefs ? { resolvedRefs: resolution.resolvedRefs } : {})
    }
  }
}
