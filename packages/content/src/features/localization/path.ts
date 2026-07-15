import type { ResolvedCollectionLocalePolicy } from './locale-policy'
import { resolveRuntimeCollectionI18nConfig, type RuntimeContentI18nInput } from './config'
import {
  longestMountForPath,
  mountContentPath,
  normalizeContentPath,
  normalizeRouteMounts,
  pathHasLocalePrefix,
  prefixPathWithLocale,
  routeRemainder,
  routeToContentPathCandidates,
  stripLocalePrefix,
  type RouteMounts
} from '../../core/content/path'
import { projectContentRoute } from './route-projector'

export {
  mountContentPath,
  normalizeContentPath,
  normalizeRouteMounts,
  prefixPathWithLocale,
  routeRemainder,
  routeToContentPathCandidates,
  stripLocalePrefix,
  type RouteMounts
}

/**
 * Package loose `(defaultLocale, mounts)` call-site params into the
 * `ResolvedCollectionLocalePolicy` shape `projectContentRoute` requires -
 * the same pattern proven in `features/query/routes.ts#getCollectionPath`.
 * This does not re-derive policy from raw config; it only reshapes params
 * the caller already resolved.
 */
const toLocalePolicy = (
  defaultLocale: string | undefined,
  mounts: RouteMounts
): ResolvedCollectionLocalePolicy => ({
  localized: true,
  locales: [],
  defaultLocale,
  fallback: {},
  translatedSlugs: false,
  routeMounts: mounts
})

/**
 * Project a content path into its localized public path.
 *
 * `path` is ordinarily the mount-agnostic canonical content path (VNEXT.md
 * section 12.2), in which case this is a straight delegation to the
 * canonical projector. It may also be an already-projected path for a
 * DIFFERENT locale (e.g. `decorateLocalePathsWithFallbacks` re-projecting a
 * fallback locale's public path onto another locale) - the mount-detection
 * step below strips that locale's mount back off first so the projector
 * still receives a mount-agnostic content path.
 */
export const projectContentPathToLocale = (
  path: string,
  locale?: string,
  defaultLocale?: string,
  mounts?: RouteMounts
) => {
  const normalizedPath = normalizeContentPath(path || '/')
  if (normalizedPath === '/' || !locale || !mounts) {
    return prefixPathWithLocale(normalizedPath, locale, defaultLocale)
  }

  const source = longestMountForPath(normalizedPath, mounts)
  const remainder = source ? routeRemainder(normalizedPath, source[1]) : normalizedPath

  return projectContentRoute({ contentPath: remainder, locale }, toLocalePolicy(defaultLocale, mounts))
}

/** Route prefixes that serve raw or API payloads - never locale-prefix these. */
const NON_LOCALIZED_PREFIXES = ['/api', '/llms', '/raw']
const HAS_FILE_EXTENSION = /\/[^/]+\.[^/]+$/

const stripExtension = (file?: string) => file?.replace(/\.[^/.]+$/, '') || ''

export const fallbackStem = (path: string) => {
  if (path === '/') {
    return 'index'
  }

  return `${path.replace(/^\/+/, '')}/index`
}

export const getContentStem = (path: string, file?: string) => stripExtension(file) || fallbackStem(path)

export const resolveCollectionI18n = (
  collection: string,
  content: RuntimeContentI18nInput
) => {
  const resolved = resolveRuntimeCollectionI18nConfig(collection, content)

  return {
    locales: resolved?.locales || [],
    defaultLocale: resolved?.defaultLocale
  }
}

/**
 * Split a URL path into its locale prefix and underlying content path.
 *
 * Example: `/de/guide/intro` with locales `['de', 'en']` and defaultLocale `en`
 * returns `{ locale: 'de', path: '/guide/intro', routePath: '/de/guide/intro' }`.
 *
 * `explicitLocale` wins over the path-derived locale when provided - callers
 * that know the active locale should pass it so `/guide/intro` is treated as
 * the default-locale variant rather than an unprefixed non-default page.
 */
export const resolveRouteContent = (
  path: string,
  locales: string[] = [],
  defaultLocale?: string,
  explicitLocale?: string
) => {
  const normalized = normalizeContentPath(path)
  const segments = normalized.split('/').filter(Boolean)
  const routeLocale = segments[0] && locales.includes(segments[0]) && segments[0] !== defaultLocale ? segments[0] : undefined
  const locale = explicitLocale && locales.includes(explicitLocale)
    ? explicitLocale
    : routeLocale || defaultLocale
  const contentPath = routeLocale
    ? normalizeContentPath('/' + segments.slice(1).join('/'))
    : normalized

  return {
    locale,
    path: contentPath || '/',
    routePath: normalized
  }
}

const splitPathSuffix = (value: string) => {
  const match = value.match(/^([^?#]*)(.*)$/)
  return {
    pathname: match?.[1] || value,
    suffix: match?.[2] || ''
  }
}

const shouldLocalizePath = (value: string | undefined, locales: string[]) => {
  if (!value || !value.startsWith('/')) {
    return false
  }

  if (value.startsWith('//')) {
    return false
  }

  if (pathHasLocalePrefix(value, locales)) {
    return false
  }

  return !NON_LOCALIZED_PREFIXES.some(prefix => value === prefix || value.startsWith(`${prefix}/`))
    && !HAS_FILE_EXTENSION.test(value)
}

/**
 * Add a locale prefix to a link-like string, preserving any `?query#hash` suffix.
 *
 * Returns `value` unchanged when the string is not a locale-able path:
 * external/protocol-relative URLs, already locale-prefixed URLs, reserved API
 * prefixes, and file-extension assets.
 */
export const localizePath = (
  value: string | undefined,
  locale?: string,
  defaultLocale?: string,
  locales: string[] = []
) => {
  if (!value) {
    return value
  }

  const { pathname, suffix } = splitPathSuffix(value)
  if (!shouldLocalizePath(pathname, locales)) {
    return value
  }

  // No route-mount concept for link-like strings - an empty mount map makes
  // `projectContentRoute` a pure locale-prefixer, identical to the old
  // direct `prefixPathWithLocale` call (VNEXT.md section 12.2).
  const projected = projectContentRoute(
    { contentPath: pathname, locale: locale ?? '' },
    toLocalePolicy(defaultLocale, {})
  )
  return `${projected}${suffix}`
}
