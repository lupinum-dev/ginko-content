import type { ParsedContentMeta } from '../content'
import type { ContentQueryBuilderWhere } from './transport'

export interface ContentCollectionNavigationOptions<TField extends string = string> {
  fields?: TField[]
  locale?: string
  canonical?: boolean
}

export type ContentCollectionItemSurroundingsOptions<TField extends string = string> = ContentCollectionNavigationOptions<TField>

export interface ContentCollectionSearchSectionsOptions {
  ignoredTags?: string[]
  extraFields?: string[]
  filterQuery?: ContentQueryBuilderWhere
  minHeading?: `h${1 | 2 | 3 | 4 | 5 | 6}`
  maxHeading?: `h${1 | 2 | 3 | 4 | 5 | 6}`
  locale?: string
  canonical?: boolean
}

export interface ContentCollectionPageOptions {
  locale?: string
  fallback?: string[] | boolean
  exact?: boolean
  canonical?: boolean
}

export interface ContentCollectionRouteMetaOptions {
  locale?: string
  fallback?: string[] | boolean
  exact?: boolean
}

export interface ResolveContentReferenceOptions {
  locale?: string
  fallback?: string[] | boolean
  exact?: boolean
  collection?: string
}

export interface ContentLocaleEntry {
  canonicalKey: string
  locale: string
  path?: string
}

export interface ContentLocaleRoute {
  locale: string
  path: string
  /** the resolved variant's route path before locale prefixing */
  unprefixedPath: string
}

export interface LocalePathEntry {
  path: string
  translated: boolean
  fallback?: string
}

export interface ContentResolvedMeta {
  locale: string
  requestedLocale?: string
  fallback: boolean
  fallbackLocale?: string
  path: string
  requestedPath?: string
  requestedRoute?: string
  requestedRef?: string
  availableLocales: string[]
  /** Resolved markdown `$ref` links for the current runtime locale. */
  resolvedRefs?: Record<string, string>
}

export interface ContentRouteMeta {
  locale: string
  defaultLocale: string
  path: string
  /** the resolved variant's route path before locale prefixing */
  unprefixedPath: string
  variants: ContentLocaleRoute[]
  localePaths: Record<string, LocalePathEntry>
  resolved: ContentResolvedMeta
}

export type ContentPageResult<T = ParsedContentMeta> = T & ContentRouteMeta & {
  stem: string
  extension?: string
}

/**
 * The canonical document-facts envelope (VNEXT.md 10.4), returned by the
 * unified query API (`one`/`many`/`resolveOne().doc`/`surround`/`backlinks`)
 * and consumed by `useContentPage`. This is a hard cut from the legacy
 * `ContentRouteMeta`/`ContentResolvedMeta` shape above: no `canonicalPath`,
 * no caller-selector echo, no indistinguishable synthesized paths.
 *
 * `requestedPath` is present only when the caller resolved the document
 * through a route/path selector; `resolvedPath` is always the document's
 * projected public path. `alternates` carries one entry per configured
 * locale that has a concrete variant (`source: 'variant'`) or a resolvable
 * fallback (`source: 'fallback'`, labeled with the `resolvedLocale` that
 * actually owns the served content) — the same distinction
 * `synthesizeAlternates` (features/localization/route-projector.ts) makes for
 * the canonical route index.
 */
export type ContentAlternate =
  | {
      locale: string
      path: string
      source: 'variant'
    }
  | {
      locale: string
      path: string
      source: 'fallback'
      resolvedLocale: string
    }

export interface ContentDocumentRoute {
  requestedPath?: string
  resolvedPath: string
  alternates: ContentAlternate[]
}

export interface ContentDocumentResolution {
  requested: {
    locale?: string
  }
  resolved: {
    locale: string
  }
  usedFallback: boolean
}

export interface ContentSitemapAlternative {
  hreflang: string
  href: string
}

export interface ContentSitemapImage {
  loc: string
}

export interface ContentSitemapEntry {
  loc: string
  _sitemap?: string
  lastmod?: string
  alternatives?: ContentSitemapAlternative[]
  images?: ContentSitemapImage[]
}

export interface ContentSearchSection {
  id: string
  title: string
  titles: string[]
  level: number
  content: string

  [key: string]: unknown
}
