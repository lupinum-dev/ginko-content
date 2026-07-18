// @vitest-environment node

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { buildProductionFixture } from '../helpers/production-fixture'
import { readGeneratedArtifact } from '../helpers/generated-artifacts'
import { collectSitemapAlternates, collectSitemapLocs, readSitemapBundle } from '../helpers/sitemap-artifacts'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = resolve(rootDir, 'playground/ginko-i18n')
const providerFixtureDir = resolve(rootDir, 'playground/ginko-provider-search')
const siteUrl = 'https://ginko-content.example.test'
const providerSiteUrl = 'https://provider-content.example.test'
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

    const englishSitemap = bundle.childSitemaps.get('__sitemap__/en-US.xml')!
    const germanSitemap = bundle.childSitemaps.get('__sitemap__/de-DE.xml')!
    expect(englishSitemap).toContain(`${siteUrl}/guide/getting-started`)
    expect(englishSitemap).not.toContain(`<loc>${siteUrl}/de/leitfaden/erste-schritte</loc>`)
    expect(germanSitemap).toContain(`${siteUrl}/de/leitfaden/erste-schritte`)
    expect(germanSitemap).not.toContain(`<loc>${siteUrl}/guide/getting-started</loc>`)
    for (const sitemap of [englishSitemap, germanSitemap]) {
      expect(sitemap).toContain('hreflang="x-default"')
      expect(sitemap).toContain('hreflang="en-US"')
      expect(sitemap).toContain('hreflang="de-DE"')
    }

    expect(allLocs).toEqual(
      expect.arrayContaining([
        `${siteUrl}/guide/getting-started`,
        `${siteUrl}/guide/advanced`,
        `${siteUrl}/guide/deep/nested`,
        `${siteUrl}/de/leitfaden/erste-schritte`,
        `${siteUrl}/de/leitfaden/tief/verschachtelt`
      ])
    )
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

  test('emits provider-owned sitemap entries through Nuxt Sitemap output', async () => {
    const fixture = await buildProductionFixture(providerFixtureDir)
    const sitemap = await readGeneratedArtifact(fixture.publicDir, 'sitemap.xml')

    expect(sitemap).toContain(`${providerSiteUrl}/docs/provider-guide`)
    expect(sitemap).toContain(`${providerSiteUrl}/de/dokumentation/provider-leitfaden`)
    expect(sitemap).toContain('hreflang="en"')
    expect(sitemap).toContain('hreflang="de"')
    expect(sitemap).not.toContain('provider-native-doc')
    expect(sitemap).not.toMatch(localOriginPattern)
    expect(sitemap).not.toMatch(repeatedLocalePrefixPattern)
  }, 240000)

  // The sitemap-assert `compiled` hook in build mode fetches collection counts
  // by spawning the just-built
  // server bundle as a real process and calling its content cache/build
  // route over HTTP (`fetchSitemapCollectionCounts` in
  // `packages/content/src/module/integration-hooks.ts`). That path was only
  // covered by a synthetic fake server in
  // `test/contracts/integration-hooks-contracts.test.ts`. This exercises it
  // against a real `nuxi build` of the existing `ginko-i18n` fixture,
  // switched into `mode: 'build'` via `CONTENT_SITEMAP_ASSERT_MODE` (see
  // `playground/ginko-i18n/nuxt.config.ts`) instead of standing up a new
  // playground.
  test('mode "build" asserts sitemap collection counts fetched from the spawned compiled server', async () => {
    const fixture = await buildProductionFixture(fixtureDir, { CONTENT_SITEMAP_ASSERT_MODE: 'build' })
    const bundle = await readSitemapBundle(fixture.publicDir)
    const allLocs = collectSitemapLocs(bundle)

    // The build only reaches this log line if `assertGeneratedSitemaps` did not throw --
    // in particular, `requiredCollections: ['docs']` (set only for this mode in the
    // fixture's nuxt.config) only passes if `fetchSitemapCollectionCounts` really spawned
    // `.output/server` and got a non-zero "docs" count back from the real build, not a
    // fake/empty one.
    expect(fixture.stdout).toMatch(/Content sitemap assertion passed for \d+ sitemaps?\./)
    expect(allLocs).toEqual(expect.arrayContaining([`${siteUrl}/guide/getting-started`]))
  }, 240000)
})
