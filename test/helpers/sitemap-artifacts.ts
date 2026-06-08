import { readGeneratedArtifact } from './generated-artifacts'

export interface ParsedSitemapUrl {
  loc: string
  alternates: Array<{
    hreflang: string
    href: string
  }>
}

export interface SitemapBundle {
  index: string
  childSitemaps: Map<string, string>
}

export function parseSitemapIndex (xml: string) {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map(match => match[1])
}

export function parseSitemapUrlset (xml: string): ParsedSitemapUrl[] {
  return Array.from(xml.matchAll(/<url>([\s\S]*?)<\/url>/g)).map(([, block]) => {
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1] || ''
    const alternates = Array.from(block.matchAll(/<xhtml:link[^>]*rel="alternate"[^>]*>/g)).map((match) => {
      const tag = match[0]
      return {
        hreflang: tag.match(/hreflang="([^"]+)"/)?.[1] || '',
        href: tag.match(/href="([^"]+)"/)?.[1] || ''
      }
    }).filter(alternate => alternate.hreflang && alternate.href)

    return { loc, alternates }
  }).filter(entry => entry.loc)
}

export async function readSitemapBundle (publicDir: string): Promise<SitemapBundle> {
  const index = await readGeneratedArtifact(publicDir, 'sitemap_index.xml')
  const childSitemaps = new Map<string, string>()
  const sitemapPaths = parseSitemapIndex(index)

  if (sitemapPaths.length === 0) {
    throw new Error('Sitemap index did not reference any child sitemaps')
  }

  for (const loc of sitemapPaths) {
    const path = sitemapLocToPublicPath(loc)
    let childSitemap = ''
    try {
      childSitemap = await readGeneratedArtifact(publicDir, path)
    } catch (error) {
      throw new Error(`Sitemap index references missing child sitemap: ${path}`, { cause: error })
    }

    if (!childSitemap.trim()) {
      throw new Error(`Sitemap index references empty child sitemap: ${path}`)
    }

    childSitemaps.set(path, childSitemap)
  }

  return { index, childSitemaps }
}

export function collectSitemapLocs (bundle: SitemapBundle) {
  return Array.from(bundle.childSitemaps.values())
    .flatMap(xml => parseSitemapUrlset(xml).map(entry => entry.loc))
}

export function collectSitemapAlternates (bundle: SitemapBundle) {
  return Array.from(bundle.childSitemaps.values())
    .flatMap(xml => parseSitemapUrlset(xml).flatMap(entry => entry.alternates))
}

function sitemapLocToPublicPath (loc: string) {
  try {
    return new URL(loc).pathname.replace(/^\/+/, '')
  } catch {
    return loc.replace(/^\/+/, '')
  }
}
