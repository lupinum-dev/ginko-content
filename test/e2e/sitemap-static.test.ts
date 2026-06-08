// @vitest-environment node

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { buildProductionFixture } from '../helpers/production-fixture'
import { collectSitemapAlternates, collectSitemapLocs, readSitemapBundle } from '../helpers/sitemap-artifacts'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = resolve(rootDir, 'playground/ginko-i18n')
const siteUrl = 'https://ginko-content.example.test'
const localOriginPattern = /http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])|https?:\/\/[^/\s"'<>]*localhost/i
const repeatedLocalePrefixPattern = /\/(?:de|en)\/(?:de|en)\//

describe('static sitemap output', () => {
  test('emits localized content routes and excludes private sitemap sources', async () => {
    const fixture = await buildProductionFixture(fixtureDir)
    const bundle = await readSitemapBundle(fixture.publicDir)
    const allSitemaps = [bundle.index, ...bundle.childSitemaps.values()].join('\n')
    const allLocs = collectSitemapLocs(bundle)
    const alternates = collectSitemapAlternates(bundle)

    expect(bundle.index).toContain(`${siteUrl}/__sitemap__/en-US.xml`)
    expect(bundle.index).toContain(`${siteUrl}/__sitemap__/de-DE.xml`)
    expect(bundle.childSitemaps.get('__sitemap__/en-US.xml')).toBeTruthy()
    expect(bundle.childSitemaps.get('__sitemap__/de-DE.xml')).toBeTruthy()

    expect(allLocs).toEqual(expect.arrayContaining([
      `${siteUrl}/guide/getting-started`,
      `${siteUrl}/guide/advanced`,
      `${siteUrl}/guide/deep/nested`,
      `${siteUrl}/de/leitfaden/erste-schritte`,
      `${siteUrl}/de/leitfaden/tief/verschachtelt`
    ]))
    expect(allLocs.length).toBeGreaterThanOrEqual(7)

    expect(alternates).toEqual(expect.arrayContaining([
      expect.objectContaining({ hreflang: 'en-US', href: `${siteUrl}/guide/deep/nested` }),
      expect.objectContaining({ hreflang: 'de-DE', href: `${siteUrl}/de/leitfaden/tief/verschachtelt` })
    ]))

    expect(allSitemaps).not.toContain('/authors/evan')
    expect(allSitemaps).not.toContain('/internal/secret')
    expect(allSitemaps).not.toContain('/guide/draft-roadmap')
    expect(allSitemaps).not.toContain('/de/leitfaden/entwurf')
    expect(allSitemaps).not.toContain('/guide/internal-note')
    expect(allSitemaps).not.toContain('/de/leitfaden/interne-notiz')
    expect(allSitemaps).not.toMatch(localOriginPattern)
    expect(allSitemaps).not.toMatch(repeatedLocalePrefixPattern)
  }, 240000)
})
