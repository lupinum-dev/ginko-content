import type { ContentNavigationItem, ContentResolutionCarrier, ParsedContent } from '../../types/content'
import type { ContentAlternate, ContentDocumentResolution, ContentDocumentRoute, ContentLocaleEntry, ContentPageResult, ContentRouteMeta, LocalePathEntry } from '../../types/query'
import type { SearchSection } from '../search/sections'
import type { ResolvedCollectionLocalePolicy } from './locale-policy'
import { sortLocalesCanonically } from '../../core/content/locale'
import { longestMountForPath, prefixPathWithLocale, routeRemainder } from '../../core/content/path'
import { localizeLinkProps } from './links'
import { getContentStem, localizePath, normalizeContentPath, type RouteMounts } from './path'
import { projectContentRoute } from './route-projector'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Package loose `(defaultLocale, routeMounts)` call-site params into the
 * `ResolvedCollectionLocalePolicy` shape `projectContentRoute` requires -
 * the same pattern proven in `features/query/routes.ts#getCollectionPath`.
 * This does not re-derive policy from raw config; it only reshapes params
 * the call site already resolved.
 */
const toLocalePolicy = (
  defaultLocale: string | undefined,
  routeMounts: RouteMounts | undefined
): ResolvedCollectionLocalePolicy => ({
  localized: true,
  locales: [],
  defaultLocale,
  fallback: {},
  translatedSlugs: false,
  routeMounts: routeMounts ?? {}
})

/**
 * Project a path into its localized public path via the canonical route
 * projector.
 *
 * `path` is ordinarily the mount-agnostic canonical content path (VNEXT.md
 * section 12.2), but some inputs reaching this hub (e.g. a third-party
 * provider's own `path`, or `decorateLocalePathsWithFallbacks` re-projecting
 * a fallback locale's already-mounted public path) may already carry a
 * mount for some locale. The
 * mount-detection step mirrors `path.ts#projectContentPathToLocale` exactly
 * so both hubs stay byte-identical: it strips whichever configured mount
 * (if any) the path already carries before handing a genuinely
 * mount-agnostic content path to the projector.
 */
const projectPath = (
  path: string,
  locale: string | undefined,
  defaultLocale: string | undefined,
  routeMounts: RouteMounts | undefined
): string => {
  const normalizedPath = normalizeContentPath(path || '/')
  if (normalizedPath === '/' || !locale || !routeMounts) {
    return prefixPathWithLocale(normalizedPath, locale, defaultLocale)
  }

  const source = longestMountForPath(normalizedPath, routeMounts)
  const remainder = source ? routeRemainder(normalizedPath, source[1]) : normalizedPath

  return projectContentRoute({ contentPath: remainder, locale }, toLocalePolicy(defaultLocale, routeMounts))
}

/**
 * Build the canonical `route.alternates` list (VNEXT.md 10.4, 27.1) for the
 * document envelope returned by the unified query API
 * (`one`/`many`/`resolveOne`/`surround`/`backlinks`) and `useContentPage`.
 *
 * One `variant` alternate is emitted per configured locale with a concrete
 * graph variant; every other configured locale gets a `fallback` alternate
 * labeled with the `resolvedLocale` that actually owns the served content —
 * the same `variant`/`fallback` distinction `synthesizeAlternates`
 * (`./route-projector.ts`) makes over the whole-collection `RouteIndex`.
 *
 * This per-document call site only has this one document's own variant map
 * (`variantPaths`), not the whole-collection route index
 * `synthesizeAlternates` needs for its cross-document content-path identity
 * check (VNEXT.md 12.3 step 9) — wiring every query result through that full
 * index is Phase 4C provider work (VNEXT.md 13, 28). A fallback candidate
 * here is always attributed to the document's own resolved/served locale,
 * which is the only fallback source this call site can prove without that
 * wider index.
 */
export const buildContentAlternates = (
  variantPaths: Record<string, string> | undefined,
  resolvedLocale: string,
  defaultLocale: string | undefined,
  locales: readonly string[],
  routeMounts: RouteMounts | undefined
): ContentAlternate[] => {
  if (!locales.length) {
    return []
  }

  const variants = variantPaths ?? {}
  const alternates: ContentAlternate[] = []

  for (const locale of locales) {
    const variantPath = variants[locale]
    if (variantPath) {
      alternates.push({
        locale,
        path: projectPath(variantPath, locale, defaultLocale, routeMounts),
        source: 'variant'
      })
      continue
    }

    if (!resolvedLocale || locale === resolvedLocale) {
      continue
    }

    const sourcePath = variants[resolvedLocale]
    if (!sourcePath) {
      // No concrete source content to fall back from at all - emit nothing
      // rather than guess (mirrors `synthesizeAlternates`'s "no candidate"
      // outcome for an empty fallback chain).
      continue
    }

    alternates.push({
      locale,
      path: projectPath(sourcePath, locale, defaultLocale, routeMounts),
      source: 'fallback',
      resolvedLocale
    })
  }

  const localeList = [...locales]
  const localeOrder = sortLocalesCanonically(localeList, { defaultLocale, locales: localeList })
  const rank = new Map(localeOrder.map((locale, index) => [locale, index]))
  return alternates.sort((a, b) => (rank.get(a.locale) ?? 0) - (rank.get(b.locale) ?? 0))
}

/** Input facts `buildContentDocumentEnvelope` needs to build one document's `route`/`resolution` envelope. */
export interface ContentDocumentEnvelopeInput {
  /** Mount-agnostic canonical content path of the resolved document. */
  unprefixedPath: string
  /** Concrete locale -> content-path map for this document's own canonical key. */
  variantPaths: Record<string, string> | undefined
  /** Locale explicitly requested by the caller, if any. */
  requestedLocale?: string
  /** Locale the document actually resolved/served in. */
  resolvedLocale: string
  defaultLocale?: string
  locales: readonly string[]
  routeMounts?: RouteMounts
  /** Original requested path/route selector value, if a route-shaped selector was used. */
  requestedPath?: string
  requestedRoute?: string
}

/**
 * Build the exact `route`/`resolution` envelope shape mandated by VNEXT.md
 * 10.4 for one resolved document: `route.resolvedPath` is always the
 * document's projected public path; `route.requestedPath` is present only
 * when the caller resolved through a route/path selector.
 * `resolution.requested.locale` is present only when the caller explicitly
 * requested a locale. No `canonicalPath`, no caller-selector echo (that stays
 * in `resolveOne().explain`), no synthesized `resolved.availableLocales`.
 */
export const buildContentDocumentEnvelope = (input: ContentDocumentEnvelopeInput): {
  locale: string
  route: ContentDocumentRoute
  resolution: ContentDocumentResolution
} => {
  const resolvedPath = projectPath(input.unprefixedPath, input.resolvedLocale, input.defaultLocale, input.routeMounts)
  const alternates = buildContentAlternates(input.variantPaths, input.resolvedLocale, input.defaultLocale, input.locales, input.routeMounts)
  const requestedPath = input.requestedPath || input.requestedRoute
  const usedFallback = Boolean(input.requestedLocale && input.resolvedLocale && input.requestedLocale !== input.resolvedLocale)

  return {
    locale: input.resolvedLocale,
    route: {
      ...(requestedPath ? { requestedPath } : {}),
      resolvedPath,
      alternates
    },
    resolution: {
      requested: {
        ...(input.requestedLocale ? { locale: input.requestedLocale } : {})
      },
      resolved: {
        locale: input.resolvedLocale
      },
      usedFallback
    }
  }
}

/**
 * Decorate a raw parsed document with the canonical `route`/`resolution`
 * envelope (VNEXT.md 10.4) consumed by the unified query API and
 * `useContentPage`.
 */
export interface DecoratedLocalizedDocument {
  locale: string
  route: ContentDocumentRoute
  resolution: ContentDocumentResolution
  stem?: string
  extension?: string
  /** Resolved markdown `$ref` links for the current runtime locale (consumed by `ContentRendererMarkdown`). */
  resolvedRefs?: Record<string, string>
}

export const decorateLocalizedDocumentEnvelope = <T extends ParsedContent & Record<string, unknown>>(
  doc: T,
  collectionLocaleConfig: {
    locales: readonly string[]
    defaultLocale?: string
    routeMounts?: RouteMounts
    hasLocaleConfig: boolean
  },
  requestedLocale?: string
): Omit<T, 'resolved'> & DecoratedLocalizedDocument => {
  const { locales, defaultLocale, routeMounts, hasLocaleConfig } = collectionLocaleConfig
  const resolution = (doc as { resolved?: ContentResolutionCarrier }).resolved
  const unprefixedPath = normalizeContentPath(doc.path || '/')
  const resolvedLocale = hasLocaleConfig
    ? (resolution?.locale || doc.locale || requestedLocale || defaultLocale || '')
    : ''

  const envelope = buildContentDocumentEnvelope({
    unprefixedPath,
    variantPaths: hasLocaleConfig ? resolution?.variantPaths : undefined,
    requestedLocale: hasLocaleConfig ? requestedLocale : undefined,
    resolvedLocale,
    defaultLocale,
    locales,
    routeMounts,
    requestedPath: resolution?.requestedPath,
    requestedRoute: resolution?.requestedRoute
  })

  // `path` is the raw, mount-agnostic, pre-projection content path the query
  // engine needs to compute `route` from — an internal decoration input, not
  // a guaranteed or selectable public field (VNEXT.md 10.3, 10.4). Excluding
  // it here (alongside the raw `resolved` carrier) keeps the single
  // `route.resolvedPath`/`route.requestedPath` pair as the only path-shaped
  // fields on the envelope, with no leaked internal duplicate.
  const { resolved: _resolved, path: _path, ...rest } = doc as Record<string, unknown>

  return {
    ...rest,
    locale: envelope.locale,
    route: envelope.route,
    resolution: envelope.resolution,
    stem: getContentStem(unprefixedPath, doc.file?.path),
    extension: doc.file?.extension,
    ...(resolution?.resolvedRefs ? { resolvedRefs: resolution.resolvedRefs } : {})
  } as Omit<T, 'resolved'> & DecoratedLocalizedDocument
}

export const createLocaleVariants = (
  variants: Record<string, string> | ContentLocaleEntry[] | undefined,
  defaultLocale?: string,
  locales: string[] = [],
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

  const localeOrder = sortLocalesCanonically(entries.map(entry => entry.locale), { defaultLocale, locales })
  const rank = new Map(localeOrder.map((locale, index) => [locale, index]))

  return entries
    .filter(entry => entry.path)
    .sort((left, right) => (rank.get(left.locale) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.locale) ?? Number.MAX_SAFE_INTEGER))
    .map(entry => ({
      locale: entry.locale,
      unprefixedPath: normalizeContentPath(entry.path || '/'),
      path: projectPath(entry.path || '/', entry.locale, defaultLocale, routeMounts)
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
 * path and `translated: false` - the `fallback` field plays the same role as
 * `resolvedLocale` on a `synthesizeAlternates` fallback alternate (VNEXT.md
 * section 12.3): it names the locale that actually owns the served content.
 *
 * The only path available here (`localePaths[fallbackLocale].path`) is
 * already a projected public path for `fallbackLocale`, not a raw content
 * path - `projectPath`'s mount-detection step strips that mount back off
 * before re-projecting onto each missing locale.
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
        path: projectPath(fallbackPath, locale, defaultLocale, routeMounts),
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
  const unprefixedPath = normalizeContentPath(page.path || '/')
  const variants = createLocaleVariants(resolution?.variantPaths, defaultLocale, locales, routeMounts)
  const path = projectPath(unprefixedPath, locale || resolution?.locale || page.locale, defaultLocale, routeMounts)
  const resolvedLocale = resolution?.locale || page.locale || locale || defaultLocale || ''
  const requestedLocale = resolution?.requestedLocale || locale
  const fallback = Boolean(resolution?.fallback || (requestedLocale && resolvedLocale && requestedLocale !== resolvedLocale))
  const result = {
    ...page,
    path,
    unprefixedPath,
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
      availableLocales: resolution?.availableLocales || sortLocalesCanonically(Object.keys(resolution?.variantPaths || {}), { defaultLocale, locales }),
      ...(resolution?.resolvedRefs ? { resolvedRefs: resolution.resolvedRefs } : {})
    },
    stem: getContentStem(unprefixedPath, page.file?.path),
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
  const rawPath = typeof item.unprefixedPath === 'string'
    ? item.unprefixedPath
    : typeof item.path === 'string'
      ? item.path
      : undefined
  if (!rawPath) {
    return {
      ...item,
      children: item.children?.map(child => localizeNavigationItem(child, locale, defaultLocale, locales, routeMounts))
    }
  }

  const unprefixedPath = normalizeContentPath(rawPath)
  const localizedPath = projectPath(unprefixedPath, locale, defaultLocale, routeMounts)
  const file = (item.file as { path?: string } | undefined)?.path
  return {
    ...item,
    path: localizedPath,
    unprefixedPath,
    stem: item.stem || getContentStem(unprefixedPath, file),
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

  const unprefixedPath = normalizeContentPath(String(item.unprefixedPath || item.path || '/'))
  return {
    ...item,
    path: projectPath(unprefixedPath, locale, defaultLocale, routeMounts),
    unprefixedPath,
    stem: item.stem || getContentStem(unprefixedPath, (item.file as { path?: string } | undefined)?.path)
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
  locales: string[] = [],
  routeMounts?: RouteMounts
): ContentRouteMeta => {
  const resolution = page.resolved
  const unprefixedPath = normalizeContentPath(page.path || '/')
  const resolvedLocale = resolution?.locale || page.locale || locale || defaultLocale || ''
  const requestedLocale = resolution?.requestedLocale || locale
  const fallback = Boolean(resolution?.fallback || (requestedLocale && resolvedLocale && requestedLocale !== resolvedLocale))
  // When re-shaping an already-localized page (e.g. route-meta over a page
  // result), the raw variant-path map has been folded into the finalized
  // `resolved` envelope and is no longer present; fall back to the variants the
  // first shaping already produced.
  const variants = resolution?.variantPaths
    ? createLocaleVariants(resolution.variantPaths, defaultLocale, locales, routeMounts)
    : (Array.isArray((page as { variants?: unknown }).variants)
        ? ((page as unknown as { variants: ReturnType<typeof createLocaleVariants> }).variants)
        : [])
  const path = projectPath(unprefixedPath, locale || resolvedLocale, defaultLocale, routeMounts)

  return {
    locale: locale || resolvedLocale,
    defaultLocale: defaultLocale || '',
    path,
    unprefixedPath,
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
      availableLocales: resolution?.availableLocales || sortLocalesCanonically(Object.keys(resolution?.variantPaths || {}), { defaultLocale, locales }),
      ...(resolution?.resolvedRefs ? { resolvedRefs: resolution.resolvedRefs } : {})
    }
  }
}
