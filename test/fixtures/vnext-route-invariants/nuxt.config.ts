import { createResolver } from '@nuxt/kit'

// VNEXT.md 20.1 / 20.5: dedicated fixture proving route/build invariants and
// content-only localization (no @nuxtjs/i18n, no @nuxtjs/sitemap installed).
// `VNEXT_SITEMAP_DISABLED=1` toggles the sitemap-enabled/disabled variants
// referenced by 20.1 without needing two separate fixture directories.
const sitemapDisabled = process.env.VNEXT_SITEMAP_DISABLED === '1'
const { resolve } = createResolver(import.meta.url)

export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },

  modules: [
    '@lupinum/ginko-content'
  ],

  content: {
    // Search is opt-in in vNext. This fixture asserts cross-artifact search
    // invariants, so enable the built-in MiniSearch index explicitly.
    search: {},
    i18n: {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      fallback: {
        de: ['en']
      },
      translatedSlugs: true
    },
    sitemap: sitemapDisabled
      ? false
      : {
          includeDrafts: false
        },
    // Real `content.transformers` wiring (VNEXT §14.4, §25): a custom
    // transformer must affect query results and generated routes
    // IDENTICALLY, the same invariant already proven for
    // `content:file:beforeParse` hooks below. `word-count.ts` stamps a
    // computed `wordCount` fact onto every markdown document; `/nav` (a
    // direct query) and the transformed page's own generated route both
    // render it (see `test/e2e/generate-output.test.ts`).
    transformers: [resolve('./transformers/word-count')]
  },

  site: {
    url: 'https://vnext-route-invariants.example.test',
    name: 'Ginko Content vNext Route Invariants Fixture'
  },

  nitro: {
    prerender: {
      // /nav, /locales, and /navigation are app-owned debug pages (not
      // content docs), so they are not discovered through Ginko's content
      // prerender-route derivation. List them explicitly; content-collection
      // routes are added automatically by the module.
      routes: ['/nav', '/locales', '/navigation'],
      failOnError: true
    }
  },

  compatibilityDate: '2026-04-14'
})
