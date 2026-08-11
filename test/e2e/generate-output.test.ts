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
const searchFixtureDir = resolve(rootDir, 'playground/ginko-search')
const i18nFixtureDir = resolve(rootDir, 'playground/ginko-i18n')
const routeInvariantsFixtureDir = resolve(rootDir, 'test/fixtures/route-invariants')
const siteUrl = 'https://ginko-content.example.test'
const basicGolden = resolve(rootDir, 'test/golden/routes/ginko-basic.txt')
const i18nGolden = resolve(rootDir, 'test/golden/routes/ginko-i18n.txt')
const routeInvariantsGolden = resolve(rootDir, 'test/golden/routes/route-invariants.txt')

// Real `nuxi generate` runs reuse the same
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
    expect(textArtifacts.some(artifact => artifact.path.endsWith('_payload.json'))).toBe(true)
    const rootHtml = await readGeneratedArtifact(outputPublicDir, 'index.html')
    expect(rootHtml).toContain('app-layer-content-component')
    expect(rootHtml).not.toContain('base-layer-content-component')

    const searchIndex = await readSearchIndex(outputPublicDir)
    expect(searchIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Getting Started', path: '/guide/getting-started' })
    ]))
    expect(JSON.stringify(searchIndex)).not.toContain(fixtureLeakSentinels.basic[0])

    // ginko-basic has no i18n locales, so the repeated-locale-prefix sweep does not apply here
    // Keep this locale list aligned with the fixture; a non-i18n fixture has
    // no locale prefix to repeat.
    assertNoLocalOrigins(textArtifacts)
    assertNoPrivateContentLeaks(textArtifacts, fixtureLeakSentinels.basic)
    await assertRouteManifestMatchesGolden(outputPublicDir, basicGolden, 'generate')
    await assertGeneratedLinkIntegrity(outputPublicDir)
  }, 300000)

  test('ginko-search: Pagefind stays inert during SSR and searches after hydration', async () => {
    const fixture = await generateStaticFixture(searchFixtureDir, {
      CONTENT_SEARCH_ENGINE: 'pagefind'
    })
    const rootHtml = await readGeneratedArtifact(fixture.publicDir, 'index.html')

    expect(rootHtml).toContain('Built-in Search Playground')
    expect(rootHtml).toContain('<p id="pending">false</p>')
    expect(rootHtml).toContain('<pre id="results">[]</pre>')
    expect(rootHtml).toContain('id="inline-baseline"')
    expect(rootHtml).toContain('data-alert="note"')
    expect(rootHtml).toContain('Inline baseline')
    expect(rootHtml).not.toContain('inline-secret')
    expect(existsSync(resolve(fixture.publicDir, 'pagefind/ginko-locales.json'))).toBe(true)
    expect(existsSync(resolve(fixture.publicDir, 'pagefind/pagefind.js'))).toBe(true)
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

    // Prove the generate-mode sitemap assertion ran during the real build.
    expect(fixture.stdout).toMatch(/Content sitemap assertion passed for \d+ sitemaps?\./)
  }, 300000)

  // This route/build fixture also covers content-only localization without
  // @nuxtjs/i18n. A real `nuxi generate`
  // run proving route mounts, translated numeric slugs, missing-translation
  // fallback, draft/partial/navigation-control/data-collection exclusion,
  // sitemap opt-out vs. prerender decoupling, and a `content:file:beforeParse`
  // hook effect appearing identically in query results and the generated
  // static route.
  test('route-invariants: real generate proves route/build invariants and content-only localization', async () => {
    await assertFixtureSourceSentinels(routeInvariantsFixtureDir, fixtureLeakSentinels.routeInvariants)
    const fixture = await generateStaticFixture(routeInvariantsFixtureDir)
    const outputPublicDir = fixture.publicDir
    const textArtifacts = await listGeneratedTextArtifacts(outputPublicDir)

    // Generated route paths include the collection mount (`docs` -> /guide,
    // /leitfaden) for both locales, including translated numeric slugs.
    expect(existsSync(resolve(outputPublicDir, 'guide/getting-started/index.html'))).toBe(true)
    expect(existsSync(resolve(outputPublicDir, 'de/leitfaden/erste-schritte/index.html'))).toBe(true)
    expect(await readGeneratedArtifact(outputPublicDir, 'guide/getting-started/index.html')).toContain('Getting Started')
    expect(await readGeneratedArtifact(outputPublicDir, 'de/leitfaden/erste-schritte/index.html')).toContain('Einstieg')

    // A page with `sitemap: false` frontmatter remains in the prerendered
    // static output: sitemap opt-out does not affect prerender.
    expect(existsSync(resolve(outputPublicDir, 'guide/excluded-from-sitemap/index.html'))).toBe(true)
    expect(existsSync(resolve(outputPublicDir, 'de/leitfaden/excluded-from-sitemap/index.html'))).toBe(true)

    // A page with `navigation: false` frontmatter still renders directly at
    // its route; only navigation listings exclude it (checked below via /nav).
    expect(existsSync(resolve(outputPublicDir, 'guide/hidden-from-nav/index.html'))).toBe(true)

    // Structural non-routes never appear: drafts, underscore-prefixed
    // partials, `.navigation.yml` control files, and `type: 'data'`
    // collection records.
    for (const artifact of textArtifacts) {
      expect(artifact.path).not.toMatch(/draft-page/)
      expect(artifact.path).not.toMatch(/internal-partial/)
      expect(artifact.path).not.toMatch(/notes\/example/)
    }
    expect(JSON.stringify(textArtifacts.map(artifact => artifact.path))).not.toContain('.navigation')

    // A `content:file:beforeParse` hook rewrites this page's `order`
    // frontmatter from 99 to 1 before parsing. The effect appears
    // identically in a direct query result (rendered on /nav, a real
    // generated route) and in the hooked page's own generated route.
    expect(await readGeneratedArtifact(outputPublicDir, 'guide/hooked-order/index.html')).toContain('order: 1')
    expect(await readGeneratedArtifact(outputPublicDir, 'de/leitfaden/hooked-order/index.html')).toContain('order: 1')
    const navJson = await readGeneratedArtifact(outputPublicDir, 'nav/index.html')
    expect(navJson).toContain('&quot;title&quot;: &quot;Hooked Order Page&quot;,\n    &quot;order&quot;: 1')

    // A real `content.transformers` registration (word-count.ts) stamps a
    // computed `wordCount` fact on every markdown document. Its effect must
    // appear IDENTICALLY in a direct query result (/nav) and in the
    // transformed page's own generated route — the same
    // parity invariant already proven above for `content:file:beforeParse`.
    const gettingStartedHtml = await readGeneratedArtifact(outputPublicDir, 'guide/getting-started/index.html')
    const pageWordCountMatch = /wordCount:\s*(\d+)/.exec(gettingStartedHtml)
    const navWordCountMatch = /&quot;path&quot;: &quot;\/guide\/getting-started&quot;,\s*\n\s*&quot;wordCount&quot;: (\d+)/.exec(navJson)
    expect(pageWordCountMatch, 'transformed page must render its computed wordCount').not.toBeNull()
    expect(navWordCountMatch, 'the direct /nav query must expose the same computed wordCount').not.toBeNull()
    expect(Number(pageWordCountMatch![1])).toBeGreaterThan(0)
    expect(navWordCountMatch![1]).toBe(pageWordCountMatch![1])

    // Per-surface exclusions are exact, proven against the
    // real navigation feature (not a client-side `where` filter like /nav
    // above). `navigation: false` removes a page from navigation only — it
    // still has its own generated route (checked above) — and `sitemap:
    // false` must NOT also remove it from navigation, since that flag is
    // sitemap-surface-only.
    const navigationJson = await readGeneratedArtifact(outputPublicDir, 'navigation/index.html')
    expect(navigationJson).not.toContain('/guide/hidden-from-nav')
    expect(navigationJson).toContain('/guide/excluded-from-sitemap')

    // Content-only localization (no @nuxtjs/i18n installed): localized
    // one/many queries, missing-translation fallback resolution, and a data
    // collection resolve correctly from a real generated route.
    const localesJson = await readGeneratedArtifact(outputPublicDir, 'locales/index.html')
    expect(localesJson).toContain('&quot;enTitle&quot;: &quot;Getting Started&quot;')
    expect(localesJson).toContain('&quot;deTitle&quot;: &quot;Einstieg&quot;')
    // The de-only-missing page falls back to its `en` content rather than 404ing.
    expect(localesJson).toContain('&quot;fallbackTitle&quot;: &quot;Advanced (English Only)&quot;')
    expect(localesJson).toContain('&quot;fallbackLocale&quot;: &quot;en&quot;')
    expect(localesJson).toContain('&quot;enNoteTitle&quot;: &quot;Example Note&quot;')

    const searchIndex = await readSearchIndex(outputPublicDir)
    expect(searchIndex).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Getting Started', path: '/guide/getting-started', locale: 'en' }),
      expect.objectContaining({ title: 'Einstieg', path: '/de/leitfaden/erste-schritte', locale: 'de' })
    ]))
    // Search has neither a `navigation:false` nor a `sitemap:false` opt-out
    // (those are exact, single-surface consumer filters that do not extend
    // to search) — both pages remain searchable.
    expect(searchIndex.map((record: { title?: string }) => record.title)).toEqual(
      expect.arrayContaining(['Hidden From Navigation', 'Excluded From Sitemap'])
    )
    for (const sentinel of fixtureLeakSentinels.routeInvariants) {
      expect(JSON.stringify(searchIndex)).not.toContain(sentinel)
    }

    // The cross-artifact golden proves query results, generated
    // routes, navigation output, and the sitemap-inclusion fact all share
    // the same document/route identity from the one canonical build and
    // apply only their own documented filter on top of it. This asserts the
    // INTERSECTION (every queried, non-navigation-opted-out page is both a
    // generated route and a navigation entry) and the DELIBERATE
    // divergences exactly (`navigation: false` removes a page from
    // navigation only; `sitemap: false` removes a page from the sitemap
    // fact only) — it does not compare final sets for equality.
    const surfaceFlagsMatch = /data-testid="nav-surface-flags">([\s\S]*?)<\/pre>/.exec(navJson)
    expect(surfaceFlagsMatch, 'the /nav surface-flags query must have rendered').not.toBeNull()
    const surfaceFlags = JSON.parse(
      surfaceFlagsMatch![1]!
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, '\'')
    ) as Array<{ path: string, navigation: boolean, sitemap: boolean }>
    const searchPaths = new Set(searchIndex.map((record: { path?: string }) => record.path))

    for (const doc of surfaceFlags) {
      // INTERSECTION: every page the query surfaces is a real generated
      // route (query and prerender share the same route facts) and is
      // searchable (this fixture opts no page out of search).
      const routeFile = doc.path === '/' ? 'index.html' : `${doc.path.replace(/^\//, '')}/index.html`
      expect(existsSync(resolve(outputPublicDir, routeFile)), `${doc.path} must be a generated route`).toBe(true)
      expect(searchPaths.has(doc.path), `${doc.path} must be searchable`).toBe(true)
      // DIVERGENCE, asserted exactly: navigation presence follows ONLY the
      // `navigation` flag; sitemap-fact presence follows ONLY the `sitemap`
      // flag — neither leaks into the other surface.
      expect(navigationJson.includes(doc.path), `${doc.path} navigation presence must match its navigation flag`).toBe(doc.navigation)
    }
    const hiddenFromNav = surfaceFlags.find(doc => doc.path === '/guide/hidden-from-nav')
    const excludedFromSitemap = surfaceFlags.find(doc => doc.path === '/guide/excluded-from-sitemap')
    expect(hiddenFromNav).toMatchObject({ navigation: false, sitemap: true })
    expect(excludedFromSitemap).toMatchObject({ navigation: true, sitemap: false })

    assertNoLocalOrigins(textArtifacts)
    assertNoRepeatedLocalePrefixes(textArtifacts, ['de', 'en'])
    assertNoPrivateContentLeaks(textArtifacts, fixtureLeakSentinels.routeInvariants)
    await assertRouteManifestMatchesGolden(outputPublicDir, routeInvariantsGolden, 'generate')
    await assertGeneratedLinkIntegrity(outputPublicDir)
  }, 300000)

  // The sitemap-enabled/disabled variant uses the same fixture.
  // Disabling the sitemap feature entirely at the module level must not
  // remove content routes from the static build. Content routes are
  // sitemap-independent by construction: they are seeded from
  // the real Nitro-side build result (`runtime/server/api/cache.ts`) via
  // Nitro's own crawl-links mechanism, never gated on `content.sitemap`.
  test('route-invariants: disabling the sitemap feature does not remove content routes from static output', async () => {
    const fixture = await generateStaticFixture(routeInvariantsFixtureDir, { ROUTE_INVARIANTS_SITEMAP_DISABLED: '1' })
    const outputPublicDir = fixture.publicDir

    expect(existsSync(resolve(outputPublicDir, 'guide/getting-started/index.html'))).toBe(true)
    expect(existsSync(resolve(outputPublicDir, 'de/leitfaden/erste-schritte/index.html'))).toBe(true)
    expect(existsSync(resolve(outputPublicDir, 'guide/excluded-from-sitemap/index.html'))).toBe(true)
  }, 300000)
})
