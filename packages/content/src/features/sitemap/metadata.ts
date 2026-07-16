import type { ContentSitemapImage } from '../../types/query'

export interface ContentSitemapMetadata {
  lastmod?: string
  images?: readonly ContentSitemapImage[]
}

type SitemapDocument = {
  sitemap?: unknown
  body?: unknown
  image?: unknown
  seo?: unknown
  ogImage?: unknown
}

const collectContentImageUrls = (body: unknown, urls = new Set<string>()) => {
  if (!body || typeof body !== 'object') return urls
  const node = body as {
    tag?: string
    props?: Record<string, unknown>
    children?: unknown[]
    value?: unknown
  }
  if (node.tag === 'img' && typeof node.props?.src === 'string') urls.add(node.props.src)
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectContentImageUrls(child, urls)
  }
  if (node.value) collectContentImageUrls(node.value, urls)
  return urls
}

const collectStructuredImageUrls = (value: unknown, urls = new Set<string>()) => {
  if (!value || typeof value !== 'object') return urls
  if (Array.isArray(value)) {
    for (const item of value) collectStructuredImageUrls(item, urls)
    return urls
  }
  const record = value as Record<string, unknown>
  for (const key of ['src', 'url', 'loc']) {
    if (typeof record[key] === 'string') urls.add(record[key])
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object') collectStructuredImageUrls(nested, urls)
  }
  return urls
}

/** Preserve document-owned sitemap metadata on the canonical route fact. */
export const extractSitemapMetadata = (
  document: SitemapDocument
): ContentSitemapMetadata | false | undefined => {
  if (document.sitemap === false) return false
  const sitemap = document.sitemap && typeof document.sitemap === 'object' && !Array.isArray(document.sitemap)
    ? document.sitemap as Record<string, unknown>
    : undefined
  const urls = collectContentImageUrls(document.body)
  for (const value of [document.sitemap, document.image, document.seo, document.ogImage]) {
    collectStructuredImageUrls(value, urls)
  }
  const images = [...urls].map(loc => ({ loc }))
  const lastmod = typeof sitemap?.lastmod === 'string' ? sitemap.lastmod : undefined
  return lastmod || images.length
    ? { ...(lastmod ? { lastmod } : {}), ...(images.length ? { images } : {}) }
    : undefined
}

const absoluteImageUrl = (siteUrl: string, loc: string) => {
  try {
    return new URL(loc).href
  } catch {
    return loc.startsWith('/') ? `${siteUrl}${loc}` : loc
  }
}

export const absolutizeSitemapImages = (
  siteUrl: string,
  images: readonly ContentSitemapImage[] | undefined
): ContentSitemapImage[] | undefined => {
  const resolved = images?.map(({ loc }) => ({ loc: absoluteImageUrl(siteUrl, loc) }))
  return resolved?.length ? resolved : undefined
}
