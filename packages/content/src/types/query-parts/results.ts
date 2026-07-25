export interface ContentCollectionNavigationOptions<TField extends string = string> {
  fields?: TField[]
  locale?: string
}

export type ContentCollectionItemSurroundingsOptions<TField extends string = string> = ContentCollectionNavigationOptions<TField>

export interface ContentCollectionSearchSectionsOptions {
  ignoredTags?: string[]
  extraFields?: string[]
  minHeading?: `h${1 | 2 | 3 | 4 | 5 | 6}`
  maxHeading?: `h${1 | 2 | 3 | 4 | 5 | 6}`
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

/**
 * The canonical document-facts envelope, returned by the
 * unified query API (`one`/`many`/`resolveOne().doc`/`surround`/`backlinks`)
 * and consumed by `useContentPage`. There is no caller-selector echo and no
 * indistinguishable synthesized path.
 *
 * `requestedPath` is present only when the caller resolved the document
 * through a route/path selector; `resolvedPath` is always the document's
 * projected public path. `alternates` carries every concrete variant the
 * provider returned (`source: 'variant'`). When this query itself resolved a
 * requested route through locale fallback, it also carries that proven route
 * as `source: 'fallback'`, labeled with the `resolvedLocale` that owns the
 * served content. It never guesses fallback URLs for unrequested locales from
 * per-document facts.
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
