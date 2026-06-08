// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { startFixtureServer } from '../helpers/fixture-server'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = resolve(rootDir, 'playground/ginko-i18n')
const outputPublicDir = resolve(fixtureDir, '.output/public')
const siteUrl = 'https://ginko-content.example.test'
const localOriginPattern = /http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])|https?:\/\/[^/\s"'<>]*localhost/i
const repeatedLocalePrefixPattern = /\/(?:de|en)\/(?:de|en)\//

async function readOutputFile (relativePath: string) {
  return readFile(resolve(outputPublicDir, relativePath), 'utf8')
}

const collectLocs = (xml: string) =>
  Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g)).map(match => match[1])

describe('static sitemap output', () => {
  test('emits localized content routes and excludes private sitemap sources', async () => {
    const server = await startFixtureServer(fixtureDir)
    try {
      const sitemapIndex = await readOutputFile('sitemap_index.xml')
      const enSitemap = await readOutputFile('__sitemap__/en-US.xml')
      const deSitemap = await readOutputFile('__sitemap__/de-DE.xml')
      const allSitemaps = [sitemapIndex, enSitemap, deSitemap].join('\n')
      const enLocs = collectLocs(enSitemap)
      const deLocs = collectLocs(deSitemap)

      expect(sitemapIndex).toContain(`${siteUrl}/__sitemap__/en-US.xml`)
      expect(sitemapIndex).toContain(`${siteUrl}/__sitemap__/de-DE.xml`)

      expect(enLocs).toEqual(expect.arrayContaining([
        `${siteUrl}/guide/getting-started`,
        `${siteUrl}/guide/advanced`,
        `${siteUrl}/guide/deep/nested`
      ]))
      expect(deLocs).toEqual(expect.arrayContaining([
        `${siteUrl}/de/leitfaden/erste-schritte`,
        `${siteUrl}/de/leitfaden/tief/verschachtelt`
      ]))
      expect(enLocs.length).toBeGreaterThanOrEqual(4)
      expect(deLocs.length).toBeGreaterThanOrEqual(3)

      expect(allSitemaps).toContain('hreflang="en-US"')
      expect(allSitemaps).toContain('hreflang="de-DE"')
      expect(allSitemaps).toContain(`${siteUrl}/guide/deep/nested`)
      expect(allSitemaps).toContain(`${siteUrl}/de/leitfaden/tief/verschachtelt`)

      expect(allSitemaps).not.toContain('/authors/evan')
      expect(allSitemaps).not.toContain('/internal/secret')
      expect(allSitemaps).not.toContain('/guide/draft-roadmap')
      expect(allSitemaps).not.toContain('/de/leitfaden/entwurf')
      expect(allSitemaps).not.toContain('/guide/internal-note')
      expect(allSitemaps).not.toContain('/de/leitfaden/interne-notiz')
      expect(allSitemaps).not.toMatch(localOriginPattern)
      expect(allSitemaps).not.toMatch(repeatedLocalePrefixPattern)
    } finally {
      await server.stop()
    }
  }, 240000)
})
