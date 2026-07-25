import type { ContentAlternate, ContentDocumentResolution, ContentDocumentRoute } from '../../types/query'
import { sortLocalesCanonically } from '../../core/content/locale'
import { normalizeContentPath } from './path'
import type { ResolvedCollectionLocalePolicy } from './locale-policy'
import { projectContentRoute } from './route-projector'

/**
 * Build the `route.alternates` facts a single resolved document can prove.
 *
 * Concrete `variantPaths` are always safe. A fallback entry is safe only when
 * the current query actually resolved that requested route to this document;
 * guessing fallback URLs for every other configured locale would require the
 * whole collection route index and could point at another canonical document.
 */
export const buildContentAlternates = (
  variantPaths: Record<string, string> | undefined,
  resolvedLocale: string,
  policy: ResolvedCollectionLocalePolicy,
  requestedLocale?: string,
  requestedRoute?: string
): ContentAlternate[] => {
  const { defaultLocale, locales } = policy
  if (!locales.length) {
    return []
  }

  const variants = variantPaths ?? {}
  const alternates: ContentAlternate[] = []

  for (const locale of locales) {
    const variantPath = variants[locale]
    if (!variantPath) continue
    alternates.push({
      locale,
      path: projectContentRoute({ contentPath: variantPath, locale }, policy),
      source: 'variant'
    })
  }

  if (
    requestedRoute
    && requestedLocale
    && locales.includes(requestedLocale)
    && resolvedLocale
    && variants[resolvedLocale]
    && requestedLocale !== resolvedLocale
    && !variants[requestedLocale]
  ) {
    alternates.push({
      locale: requestedLocale,
      path: normalizeContentPath(requestedRoute),
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
  localePolicy: ResolvedCollectionLocalePolicy
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
  const resolvedPath = projectContentRoute({
    contentPath: input.unprefixedPath,
    locale: input.resolvedLocale
  }, input.localePolicy)
  const alternates = buildContentAlternates(
    input.variantPaths,
    input.resolvedLocale,
    input.localePolicy,
    input.requestedLocale,
    input.requestedRoute
  )
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
