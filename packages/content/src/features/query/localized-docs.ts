import type { ParsedContent } from '../../types/content'
import type { LocalizedDoc } from '../../types/query'
import { decorateLocalizedDocumentEnvelope } from '../../features/localization/results'
import { normalizeContentPath, normalizeRouteMounts } from '../../features/localization/path'
import type { RuntimeContentConfig } from './context'

const collectionLocaleConfig = (
  collection: string,
  runtime: RuntimeContentConfig | undefined
) => {
  const collectionConfig = runtime?.collections?.[collection]
  const collectionI18n = collectionConfig?.i18n
  const collectionLocales = collectionI18n && typeof collectionI18n === 'object' ? collectionI18n.locales : undefined
  const collectionDefault = collectionI18n && typeof collectionI18n === 'object' ? collectionI18n.defaultLocale : undefined
  const locales = collectionLocales?.length ? collectionLocales : (runtime?.locales?.length ? runtime.locales : [])
  const defaultLocale = collectionDefault || runtime?.defaultLocale
  const routeMounts = normalizeRouteMounts(collectionConfig?.route, locales, defaultLocale)

  return {
    locales,
    defaultLocale,
    routeMounts,
    hasLocaleConfig: Boolean(locales.length || defaultLocale)
  }
}

/**
 * Decorate a raw parsed document with the canonical `route`/`resolution`
 * envelope (VNEXT.md 10.4) the unified query API and `useContentPage` return.
 */
export const decorateLocalizedDocument = <T extends ParsedContent & Record<string, unknown>>(
  doc: T | null,
  collection: string,
  runtime: RuntimeContentConfig | undefined,
  requestedLocale?: string
): LocalizedDoc<T> | null => {
  if (!doc) return null

  const { locales, defaultLocale, routeMounts, hasLocaleConfig } = collectionLocaleConfig(collection, runtime)
  return decorateLocalizedDocumentEnvelope(
    doc,
    { locales, defaultLocale, routeMounts, hasLocaleConfig },
    requestedLocale
  ) as LocalizedDoc<T>
}

const collectionRouteRoots = (
  collection: string,
  runtime: RuntimeContentConfig | undefined
) => {
  const { routeMounts } = collectionLocaleConfig(collection, runtime)
  return new Set(Object.values(routeMounts || {}).map(value => normalizeContentPath(value)))
}

export const isCollectionRouteRoot = (
  path: string,
  collection: string,
  runtime: RuntimeContentConfig | undefined
) => collectionRouteRoots(collection, runtime).has(normalizeContentPath(path))

const isAncestorRoutePath = (path: string, childPath: string) => {
  const normalized = normalizeContentPath(path)
  const child = normalizeContentPath(childPath)
  return normalized === '/'
    ? child !== '/'
    : child.startsWith(`${normalized}/`)
}

export const isNavigationRootPath = (
  path: string,
  flat: Array<{ path: string, item: unknown }>
) => Boolean(flat[0]?.path && isAncestorRoutePath(path, flat[0].path))
