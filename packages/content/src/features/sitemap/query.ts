import type { ContentSitemapAlternative, ContentSitemapEntry, ContentSitemapImage } from '../../types/query'
import { createContentProviderError } from '../../core/provider-errors'
import { resolveIncludeDrafts, resolveRuntimeEnvironment } from '../../core/visibility'

type ContentLikePage = {
  path?: string
  collection?: string
  canonicalKey?: string
  locale?: string
  draft?: boolean
  sitemap?: unknown
  body?: unknown
  image?: unknown
  seo?: unknown
  ogImage?: unknown
}

type LocaleConfig = {
  code: string
  language?: string
}

export interface QueryCollectionsSitemapEntriesOptions {
  /**
   * Restrict generation to these collection names.
   */
  include?: string[]
  /**
   * Exclude these collection names from generation.
   */
  exclude?: string[]
  /**
   * Include draft entries. Defaults to `true` in dev and `false` otherwise.
   */
  includeDrafts?: boolean
  /**
   * Absolute site URL used to expand relative paths in the final entries.
   */
  siteUrl?: string
}

export interface SitemapRuntime {
  collections?: Record<string, { sitemap?: boolean } | unknown>
  defaultLocale?: string
  runtimeSiteUrl?: string
  localeConfigs?: LocaleConfig[]
  requestSiteUrl?: string
}

export interface SitemapLoaders {
  loadCollectionPages: (collection: string) => Promise<ContentLikePage[]>
  loadRouteMeta: (collection: string, path: string, locale?: string) => Promise<{
    locale: string
    path: string
    defaultLocale: string
    variants: Array<{ locale: string, path: string }>
  } | null>
  loadPage: (collection: string, path: string, locale?: string) => Promise<{ body?: unknown } | null>
}

const normalizeSiteUrl = (siteUrl?: string) => siteUrl?.replace(/\/$/, '')

const resolveSiteUrl = (runtime: SitemapRuntime, explicitSiteUrl?: string) => {
  const normalizedExplicitSiteUrl = normalizeSiteUrl(explicitSiteUrl)
  if (normalizedExplicitSiteUrl) {
    return normalizedExplicitSiteUrl
  }

  const normalizedRuntimeSiteUrl = normalizeSiteUrl(runtime.runtimeSiteUrl)
  if (normalizedRuntimeSiteUrl) {
    return normalizedRuntimeSiteUrl
  }

  if (runtime.requestSiteUrl && process.env.NODE_ENV !== 'production') {
    return runtime.requestSiteUrl
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Content sitemap generation requires site.url or runtimeConfig.public.content.siteUrl in production.')
  }

  return 'http://localhost'
}

const collectContentImageUrls = (body: unknown, urls = new Set<string>()) => {
  if (!body) {
    return urls
  }

  if (typeof body !== 'object') {
    return urls
  }

  const node = body as {
    tag?: string
    props?: Record<string, unknown>
    children?: unknown[]
    value?: unknown
  }

  if (node.tag === 'img' && typeof node.props?.src === 'string') {
    urls.add(node.props.src)
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectContentImageUrls(child, urls)
    }
  }

  if (node.value) {
    collectContentImageUrls(node.value, urls)
  }

  return urls
}

const collectStructuredImageUrls = (value: unknown, urls = new Set<string>()) => {
  if (!value || typeof value !== 'object') {
    return urls
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStructuredImageUrls(item, urls)
    }
    return urls
  }

  const record = value as Record<string, unknown>
  for (const key of ['src', 'url', 'loc']) {
    if (typeof record[key] === 'string') {
      urls.add(record[key] as string)
    }
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object') {
      collectStructuredImageUrls(nested, urls)
    }
  }

  return urls
}

const toAbsoluteImageUrl = (siteUrl: string, loc: string) => {
  try {
    return new URL(loc).href
  } catch {
    return loc.startsWith('/') ? `${siteUrl}${loc}` : loc
  }
}

const toPageSitemapImages = (siteUrl: string, page: ContentLikePage | null | undefined, body: unknown): ContentSitemapImage[] | undefined => {
  const urls = collectContentImageUrls(body)

  if (page) {
    collectStructuredImageUrls(page.sitemap, urls)
    collectStructuredImageUrls(page.image, urls)
    collectStructuredImageUrls(page.seo, urls)
    collectStructuredImageUrls(page.ogImage, urls)
  }

  const images = Array.from(urls).map(loc => ({ loc: toAbsoluteImageUrl(siteUrl, loc) }))
  return images.length ? images : undefined
}

const toAbsoluteUrl = (siteUrl: string, path: string) => `${siteUrl}${path}`

const buildAlternatives = (
  siteUrl: string,
  defaultLocale: string,
  localeToLanguage: Record<string, string>,
  variants: Array<{ locale: string, path: string }>
): ContentSitemapAlternative[] => {
  const alternatives = variants.map(variant => ({
    hreflang: localeToLanguage[variant.locale] || variant.locale,
    href: toAbsoluteUrl(siteUrl, variant.path)
  }))

  const defaultVariant = variants.find(variant => variant.locale === defaultLocale)
  if (defaultVariant) {
    alternatives.unshift({
      hreflang: 'x-default',
      href: toAbsoluteUrl(siteUrl, defaultVariant.path)
    })
  }

  return alternatives
}

const resolveSitemapCollections = (
  runtime: SitemapRuntime,
  options: Pick<QueryCollectionsSitemapEntriesOptions, 'include' | 'exclude'> = {}
) => {
  const hasExplicitInclude = Boolean(options.include?.length)
  const include = hasExplicitInclude ? options.include! : Object.keys(runtime.collections || {})
  const excluded = new Set(options.exclude || [])
  return include.filter((collection) => {
    const config = runtime.collections?.[collection] as { sitemap?: boolean } | undefined
    if (excluded.has(collection)) {
      return false
    }

    if (config?.sitemap === false) {
      if (hasExplicitInclude) {
        throw createContentProviderError('data_collection_sitemap_access', `${collection} is not sitemap-backed.`, {
          collection
        })
      }
      return false
    }

    return true
  })
}

/**
 * Build sitemap entries from collection pages plus route/page loaders.
 *
 * This is the pure implementation behind the public server helper. It keeps
 * URL resolution, locale alternatives, and image extraction testable without
 * coupling the logic to Nitro.
 */
export async function queryCollectionsSitemapEntriesData (
  runtime: SitemapRuntime,
  loaders: SitemapLoaders,
  options: QueryCollectionsSitemapEntriesOptions = {}
): Promise<ContentSitemapEntry[]> {
  const localeToLanguage = Object.fromEntries((runtime.localeConfigs || []).map(locale => [locale.code, locale.language || locale.code]))
  const collections = resolveSitemapCollections(runtime, options)
  const siteUrl = resolveSiteUrl(runtime, options.siteUrl)
  const shouldIncludeDrafts = resolveIncludeDrafts({
    environment: resolveRuntimeEnvironment(),
    includeDrafts: options.includeDrafts
  })
  const pages = (await Promise.all(collections.map(async (collection) => {
    const collectionPages = await loaders.loadCollectionPages(collection)
    return collectionPages.map(page => ({
      ...page,
      collection: page.collection || collection
    }))
  }))).flat()
    .filter((page) => {
      if (page.sitemap === false) {
        return false
      }

      return shouldIncludeDrafts || !page.draft
    })
  const uniquePages = Array.from(new Map(
    pages.map(page => [
      `${page.collection || ''}:${page.canonicalKey || page.path || ''}`,
      page
    ])
  ).values())

  const rawEntries = await Promise.all(uniquePages.map(async (page) => {
    if (!page.path || !page.collection) {
      return []
    }

    const meta = await loaders.loadRouteMeta(page.collection, page.path, page.locale)
    if (!meta) {
      return []
    }

    const variants = (meta.variants.length ? meta.variants : [{ locale: meta.locale, path: meta.path }]).filter(variant => variant.path)
    const localizedVariants = variants.filter(variant => variant.locale)
    const alternatives = localizedVariants.length > 1
      ? buildAlternatives(siteUrl, meta.defaultLocale, localeToLanguage, variants)
      : undefined

    return await Promise.all(variants.map(async (variant) => {
      const variantPage = await loaders.loadPage(page.collection!, variant.path, variant.locale)
      const images = toPageSitemapImages(
        siteUrl,
        variantPage ? { ...page, ...(variantPage as ContentLikePage) } : page,
        variantPage?.body ?? page.body
      )

      return {
        loc: variant.path,
        ...(variant.locale ? { _sitemap: localeToLanguage[variant.locale] || variant.locale } : {}),
        ...(alternatives ? { alternatives } : {}),
        ...(images ? { images } : {})
      } satisfies ContentSitemapEntry
    }))
  }))

  const uniqueEntries = new Map<string, ContentSitemapEntry>()
  for (const entry of rawEntries.flat()) {
    uniqueEntries.set(`${entry._sitemap || 'default'}:${entry.loc}`, entry)
  }

  return Array.from(uniqueEntries.values())
}
