import type { ParsedContent } from '../../types/content'
import type { ContentPageResult, ContentRouteMeta } from '../../types/query'
import { createCollectionSurroundings } from '../navigation/tree'
import { createSearchSections, type GenerateSearchSectionsOptions } from '../search/sections'
import type { RuntimeContentI18nInput } from '../localization/config'
import { normalizeContentPath, resolveCollectionI18n, resolveRouteContent } from '../localization/path'
import { createRouteMeta, localizePageResult, localizeSearchSections } from '../localization/results'

export interface CollectionResolveRuntime extends RuntimeContentI18nInput {
  localeFallback?: Record<string, string[]>
  translatedSlugs?: boolean
}

export const resolveCollectionNavigationData = async (
  collection: string,
  _runtime: CollectionResolveRuntime,
  options: {
    fields?: string[]
    locale?: string
    canonical?: boolean
    activeLocale?: string
    loadNavigation: () => Promise<any[]>
  }
) => {
  return await options.loadNavigation()
}

export const resolveCollectionItemSurroundingsData = async (
  collection: string,
  path: string,
  runtime: CollectionResolveRuntime,
  options: {
    before?: number
    after?: number
    fields?: string[]
    locale?: string
    canonical?: boolean
    activeLocale?: string
    loadNavigation: (options: { fields?: string[], locale?: string, canonical?: boolean }) => Promise<any[]>
  }
) => {
  const { locales, defaultLocale } = resolveCollectionI18n(collection, runtime)
  const resolved = resolveRouteContent(path, locales, defaultLocale, options.locale)
  const navigation = await options.loadNavigation({
    fields: options.fields || [],
    locale: resolved.locale || options.activeLocale,
    canonical: options.canonical
  })
  const localizedPath = options.canonical ? normalizeContentPath(resolved.path) : normalizeContentPath(resolved.routePath)
  return createCollectionSurroundings(navigation, localizedPath, options)
}

export const resolveCollectionSearchSectionsData = async (
  collection: string,
  runtime: CollectionResolveRuntime,
  options: (GenerateSearchSectionsOptions & { locale?: string, canonical?: boolean, activeLocale?: string }) & {
    loadPages: (extraFields: string[]) => Promise<Array<Pick<ParsedContent, 'path' | 'title' | 'description' | 'body'> & Record<string, unknown>>>
  }
) => {
  const { locales, defaultLocale } = resolveCollectionI18n(collection, runtime)
  const locale = options.locale || options.activeLocale || defaultLocale
  const pages = await options.loadPages(options.extraFields || [])
  const sections = createSearchSections(pages, options)
  return options.canonical ? sections : localizeSearchSections(sections, locale, defaultLocale, locales)
}

export const resolveCollectionPageData = async <T = ParsedContent> (
  collection: string,
  routeOrPath: string | undefined,
  runtime: CollectionResolveRuntime,
  options: {
    locale?: string
    fallback?: string[] | boolean
    canonical?: boolean
    fallbackRoute?: string
    loadVariantPage: (input: { path: string, locale?: string, fallback?: string[] | boolean }) => Promise<(T & ParsedContent) | null>
    loadPathPage: (path: string) => Promise<(T & ParsedContent) | null>
  }
): Promise<ContentPageResult<T> | null> => {
  const { locales, defaultLocale } = resolveCollectionI18n(collection, runtime)
  const targetPath = routeOrPath || options.fallbackRoute || '/'
  const resolved = resolveRouteContent(targetPath, locales, defaultLocale, options.locale)
  const shouldResolveVariant = Boolean(locales.length || runtime.translatedSlugs || Object.keys(runtime.localeFallback || {}).length)
  const page = shouldResolveVariant
    ? await options.loadVariantPage({
        path: resolved.path,
        locale: resolved.locale,
        fallback: options.fallback ?? ((resolved.locale && runtime.localeFallback?.[resolved.locale]) || [])
      })
    : await options.loadPathPage(resolved.path)

  if (!page) {
    return null
  }

  if (options.canonical) {
    const canonicalPath = normalizeContentPath(page.path || '/')
    const resolvedLocale = page._resolvedLocale || page._locale || resolved.locale || defaultLocale || ''
    const requestedLocale = page._requestedLocale || resolved.locale
    const fallback = Boolean(page._fallback || (requestedLocale && resolvedLocale && requestedLocale !== resolvedLocale))
    return {
      ...page,
      path: canonicalPath,
      canonicalPath,
      locale: resolved.locale || resolvedLocale,
      defaultLocale: defaultLocale || '',
      variants: [],
      localePaths: {},
      resolved: {
        locale: resolvedLocale,
        ...(requestedLocale ? { requestedLocale } : {}),
        fallback,
        ...(fallback ? { fallbackLocale: resolvedLocale } : {}),
        path: canonicalPath,
        ...(page._requestedPath ? { requestedPath: page._requestedPath } : {}),
        ...(page._requestedRoute ? { requestedRoute: page._requestedRoute } : {}),
        ...(page._requestedRef ? { requestedRef: page._requestedRef } : {}),
        availableLocales: page._availableLocales || Object.keys(page._variantPaths || {})
      },
      stem: canonicalPath.replace(/^\/+/, '') || 'index',
      extension: page.file?.extension
    } as ContentPageResult<T>
  }

  return localizePageResult(page, resolved.locale, defaultLocale, locales)
}

export const resolveCollectionRouteMetaData = async (
  collection: string,
  runtime: CollectionResolveRuntime,
  options: {
    routeOrPath?: string
    locale?: string
    fallback?: string[] | boolean
    loadPage: (routeOrPath?: string, options?: { locale?: string, fallback?: string[] | boolean, canonical?: boolean }) => Promise<ContentPageResult<any> | null>
  }
): Promise<ContentRouteMeta | null> => {
  const page = await options.loadPage(options.routeOrPath, { locale: options.locale, fallback: options.fallback })
  if (!page) {
    return null
  }

  const { defaultLocale } = resolveCollectionI18n(collection, runtime)
  return createRouteMeta(page, page.locale, defaultLocale)
}
