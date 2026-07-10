// `CONTENT_SITEMAP_ASSERT_MODE` lets `test/e2e/sitemap-static.test.ts` (or a
// dedicated build-mode e2e test) opt this same fixture into `mode: 'build'`/
// `'both'` without a second playground: that mode routes the sitemap
// assertion through `registerContentNitroIntegrationHooks`'s `'compiled'`
// hook, which spawns the just-built server bundle and fetches sitemap
// collection counts from it over HTTP (`fetchSitemapCollectionCounts` in
// `packages/content/src/module/integration-hooks.ts`) instead of reading
// `sitemap:prerender:done` output. Left unset, this fixture's existing
// default behavior (`mode: 'generate'`) is unchanged.
const sitemapAssertMode = (process.env.CONTENT_SITEMAP_ASSERT_MODE as 'generate' | 'build' | 'both' | undefined) || 'generate'

export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  extends: ['../shared'],

  modules: [
    '@lupinum/ginko-content',
    '@nuxtjs/i18n',
    '@nuxtjs/sitemap'
  ],

  content: {
    // Nuxt I18n (configured below) is the sole locale/default-locale
    // authority (VNEXT.md §12.1): content.i18n must not repeat "locales" or
    // "defaultLocale" once "@nuxtjs/i18n" is installed. Ginko content still
    // owns fallback and translated-slug policy.
    i18n: {
      fallback: {
        de: ['en']
      },
      translatedSlugs: true
    },
    sitemap: {
      assert: {
        // NB: previously used non-existent `routes`/`forbidden` keys, which were silently
        // ignored (and `enabled` defaulted to false) -- the sitemap-assert hook never actually
        // ran for this fixture. Fixed as part of TH-T1-3 so the real `mode: 'generate'` hook
        // path (shouldRunSitemapAssertionOnPrerenderedSitemaps, C-6) is exercised by a real run.
        enabled: true,
        mode: sitemapAssertMode,
        requiredPaths: ['/guide/getting-started', '/de/leitfaden/erste-schritte'],
        forbiddenPathPrefixes: ['/authors/evan', '/guide/draft-roadmap', '/de/leitfaden/entwurf'],
        // Only asserted for the `build`/`both` variant above: it is the one that
        // depends on `fetchSitemapCollectionCounts`'s spawned-server fetch for its
        // collection counts (the `generate`-mode default gets its counts from
        // `readPersistedSitemapCollectionCounts` instead, which this fixture's
        // existing default-mode e2e coverage already exercises).
        ...(sitemapAssertMode === 'generate' ? {} : { requiredCollections: ['docs'] })
      }
    },
    links: {
      main: {
        pricing: { route: 'pricing' }
      }
    }
  },

  site: {
    url: 'https://ginko-content.example.test',
    name: 'Ginko Content Playground'
  },

  // Application-owned sitemap-surface policy (Ginko derives facts; the app
  // owns 404/redirect/head/SEO policy -- see AGENTS.md). `internal` is a
  // route-mounted, sitemap-opted-out collection: VNEXT 20.1 requires it to
  // stay in the prerendered/static build (its route comes from the real
  // Nitro-side build result via crawl-links -- see
  // packages/content/src/runtime/server/api/cache.ts), but Nuxt Sitemap's
  // own default "prerendered routes" auto-discovery source is separate from
  // Ginko's `sitemap:false`-aware content source and would otherwise still
  // list it. Excluding it here keeps the *sitemap surface* policy exact
  // without re-coupling prerender to sitemap opt-out.
  sitemap: {
    exclude: ['/internal/secret', '/de/internal/secret']
  },

  i18n: {
    baseUrl: 'https://ginko-content.example.test',
    strategy: 'prefix_except_default',
    customRoutes: 'config',
    pages: {
      pricing: {
        en: '/pricing',
        de: '/preise'
      }
    },
    defaultLocale: 'en',
    detectBrowserLanguage: false,
    locales: [
      { code: 'en', language: 'en-US', name: 'English' },
      { code: 'de', language: 'de-DE', name: 'Deutsch' }
    ],
    vueI18n: './i18n.config.ts'
  },

  compatibilityDate: '2026-04-14'
})
