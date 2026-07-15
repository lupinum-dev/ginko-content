import type { ContentResolutionCarrier, ParsedContent } from '../../types/content'
import type { ContentAlternate, ContentDocumentResolution, ContentDocumentRoute } from '../../types/query'
import { sortLocalesCanonically } from '../../core/content/locale'
import { getContentStem, normalizeContentPath, projectContentPathToLocale, type RouteMounts } from './path'

/**
 * Build the canonical `route.alternates` list for the
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
 * check — wiring every query result through that full
 * index is Phase 4C provider work. A fallback candidate
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
        path: projectContentPathToLocale(variantPath, locale, defaultLocale, routeMounts),
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
      path: projectContentPathToLocale(sourcePath, locale, defaultLocale, routeMounts),
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
 * Build the canonical `route`/`resolution` envelope shape.
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
  const resolvedPath = projectContentPathToLocale(input.unprefixedPath, input.resolvedLocale, input.defaultLocale, input.routeMounts)
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
 * envelope consumed by the unified query API and
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
  // a guaranteed or selectable public field. Excluding
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
