import type { ParsedContent } from '../../types/content'
import type { LocalizedDoc } from '../../types/query'
import { decorateLocalizedDocumentEnvelope } from '../../features/localization/results'
import { normalizeContentPath, normalizeRouteMounts } from '../../features/localization/path'
import type { RuntimeContentConfig } from './context'
import { resolveRuntimeCollectionI18nConfig } from '../localization/config'

const collectionLocaleConfig = (
  collection: string,
  runtime: RuntimeContentConfig | undefined
) => {
  const collectionConfig = runtime?.collections?.[collection]
  const collectionI18n = runtime
    ? resolveRuntimeCollectionI18nConfig(collection, runtime)
    : undefined
  const locales = collectionI18n?.locales || []
  const defaultLocale = collectionI18n?.defaultLocale
  const routeMounts = normalizeRouteMounts(collectionConfig?.route, locales, defaultLocale)

  return {
    locales,
    defaultLocale,
    routeMounts,
    hasLocaleConfig: Boolean(collectionI18n)
  }
}

/**
 * Decorate a raw parsed document with the canonical `route`/`resolution`
 * envelope the unified query API and `useContentPage` return.
 */
export const decorateLocalizedDocument = <T extends ParsedContent & Record<string, unknown>>(
  doc: T | null,
  collection: string,
  runtime: RuntimeContentConfig | undefined,
  requestedLocale?: string
): LocalizedDoc<T> | null => {
  if (!doc) return null

  // Server/provider transports already return the canonical public envelope.
  // Keep that single source of truth instead of attempting to project a
  // second time from the intentionally removed top-level `path` field.
  if (
    typeof doc.route === 'object'
    && doc.route !== null
    && typeof (doc.route as { resolvedPath?: unknown }).resolvedPath === 'string'
    && typeof doc.resolution === 'object'
    && doc.resolution !== null
  ) {
    return doc as unknown as LocalizedDoc<T>
  }

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
