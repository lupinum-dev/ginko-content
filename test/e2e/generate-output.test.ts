// @vitest-environment node

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  assertFixtureSourceSentinels,
  assertNoLocalOrigins,
  assertNoPrivateContentLeaks,
  assertNoRepeatedLocalePrefixes,
  listGeneratedTextArtifacts,
  readGeneratedArtifact,
  readSearchIndex,
  fixtureLeakSentinels
} from '../helpers/generated-artifacts'
import { generateStaticFixture } from '../helpers/production-fixture'
import { assertRouteManifestMatchesGolden } from '../helpers/route-manifest'
import { assertGeneratedLinkIntegrity } from '../../scripts/lib/generated-link-integrity.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const basicFixtureDir = resolve(rootDir, 'playground/ginko-basic')
const i18nFixtureDir = resolve(rootDir, 'playground/ginko-i18n')
const siteUrl = 'https://ginko-content.example.test'
const basicGolden = resolve(rootDir, 'test/golden/routes/ginko-basic.txt')
const i18nGolden = resolve(rootDir, 'test/golden/routes/ginko-i18n.txt')

// R-1: real `nuxi generate` runs for exactly these two fixtures. Reuses the same
// generated-artifacts.ts assertions and leak sweeps as the `nuxi build` lane
// (generated-output-smoke.test.ts) so the fully static deployment story is verified by a real
// run instead of only by `nuxi build` + nitro.prerender (RFC gap #1).
describe('generate lane output (nuxi generate)', () => {
  test('ginko-basic: static generate emits stable HTML + search artifacts, free of local-origin and private-content leaks', async () => {
    await assertFixtureSourceSentinels(basicFixtureDir, fixtureLeakSentinels.basic)
    const fixture = await generateStaticFixture(basicFixtureDir)
    const outputPublicDir = fixture.publicDir
    const textArtifacts = await listGeneratedTextArtifacts(outputPublicDir)

    expect(existsSync(resolve(outputPublicDir, 'guide/getting-started/index.html'))).toBe(true)
    expect(await readGeneratedArtifact(outputPublicDir, 'guide/getting-started/index.html')).toContain('Getting Started')

    const searchIndex = await readSearchIndex(outputPublicDir)
    expect(searchIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Getting Started', path: '/guide/getting-started' })
    ]))
    expect(JSON.stringify(searchIndex)).not.toContain(fixtureLeakSentinels.basic[0])

    // ginko-basic has no i18n locales, so the repeated-locale-prefix sweep does not apply here
    // (see C-4: keep the locale list passed to that sweep matching the fixture's actual
    // locales -- an empty/non-i18n fixture has none to double).
    assertNoLocalOrigins(textArtifacts)
    assertNoPrivateContentLeaks(textArtifacts, fixtureLeakSentinels.basic)
    await assertRouteManifestMatchesGolden(outputPublicDir, basicGolden, 'generate')
    await assertGeneratedLinkIntegrity(outputPublicDir)
  }, 300000)

  test('ginko-i18n: static generate emits localized HTML/sitemap/search/agent artifacts and fires the generate sitemap-assert hook', async () => {
    await assertFixtureSourceSentinels(i18nFixtureDir, fixtureLeakSentinels.i18n)
    const fixture = await generateStaticFixture(i18nFixtureDir)
    const outputPublicDir = fixture.publicDir
    const textArtifacts = await listGeneratedTextArtifacts(outputPublicDir)

    expect(existsSync(resolve(outputPublicDir, 'guide/getting-started/index.html'))).toBe(true)
    expect(existsSync(resolve(outputPublicDir, 'de/leitfaden/erste-schritte/index.html'))).toBe(true)
    expect(await readGeneratedArtifact(outputPublicDir, 'guide/getting-started/index.html')).toContain('Getting Started')
    expect(await readGeneratedArtifact(outputPublicDir, 'de/leitfaden/erste-schritte/index.html')).toContain('Einstieg')

    const searchIndex = await readSearchIndex(outputPublicDir)
    expect(searchIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Getting Started', path: '/guide/getting-started', locale: 'en' }),
      expect.objectContaining({ title: 'Einstieg', path: '/de/leitfaden/erste-schritte', locale: 'de' })
    ]))
    expect(JSON.stringify(searchIndex)).not.toContain('/authors/evan')
    for (const sentinel of fixtureLeakSentinels.i18n) {
      expect(JSON.stringify(searchIndex)).not.toContain(sentinel)
    }

    const sitemapText = [
      await readGeneratedArtifact(outputPublicDir, '__sitemap__/en-US.xml'),
      await readGeneratedArtifact(outputPublicDir, '__sitemap__/de-DE.xml')
    ].join('\n')
    expect(sitemapText).toContain(`${siteUrl}/guide/getting-started`)
    expect(sitemapText).toContain(`${siteUrl}/de/leitfaden/erste-schritte`)
    expect(sitemapText).toContain('hreflang="en-US"')
    expect(sitemapText).toContain('hreflang="de-DE"')
    expect(sitemapText).not.toContain('/authors/evan')
    expect(sitemapText).not.toContain('/guide/draft-roadmap')
    expect(sitemapText).not.toContain('/de/leitfaden/entwurf')
    expect(sitemapText).not.toContain('/guide/internal-note')
    expect(sitemapText).not.toContain('/de/leitfaden/interne-notiz')

    const enMarkdown = await readGeneratedArtifact(outputPublicDir, 'raw/guide/getting-started.md')
    const deMarkdown = await readGeneratedArtifact(outputPublicDir, 'raw/de/leitfaden/erste-schritte.md')
    expect(existsSync(resolve(outputPublicDir, 'guide/getting-started/index.md'))).toBe(false)
    expect(existsSync(resolve(outputPublicDir, 'de/leitfaden/erste-schritte/index.md'))).toBe(false)
    expect(enMarkdown).toContain('# Getting Started')
    expect(deMarkdown).toContain('# Einstieg')
    expect(enMarkdown).not.toContain('/index.md')
    expect(deMarkdown).not.toContain('/index.md')

    const llms = await readGeneratedArtifact(outputPublicDir, 'llms.txt')
    const deLlms = await readGeneratedArtifact(outputPublicDir, 'de/llms.txt')
    const llmsFull = await readGeneratedArtifact(outputPublicDir, 'llms-full.txt')
    expect(llms).toContain('/raw/guide/getting-started.md')
    expect(deLlms).toContain('/raw/de/leitfaden/erste-schritte.md')
    expect(llmsFull).toContain('# Getting Started')
    expect(llmsFull).toContain('# Contact')
    for (const sentinel of fixtureLeakSentinels.i18n) {
      expect(llmsFull).not.toContain(sentinel)
    }
    expect(llmsFull).not.toContain('/index.md')

    assertNoLocalOrigins(textArtifacts)
    assertNoRepeatedLocalePrefixes(textArtifacts, ['de', 'en'])
    assertNoPrivateContentLeaks(textArtifacts, fixtureLeakSentinels.i18n)
    await assertRouteManifestMatchesGolden(outputPublicDir, i18nGolden, 'generate')
    await assertGeneratedLinkIntegrity(outputPublicDir)

    // T1-3 / C-6: corroborate the mode:'generate' sitemap-assert hook
    // (shouldRunSitemapAssertionOnPrerenderedSitemaps, not the `build`/`compiled` path) actually
    // ran and passed during this real `nuxi generate` invocation -- not just the synthetic
    // temp-dir contract test in sitemap-assert-contracts.test.ts.
    expect(fixture.stdout).toMatch(/Content sitemap assertion passed for \d+ sitemaps?\./)
  }, 300000)
})
