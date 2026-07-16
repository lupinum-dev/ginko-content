import { createResolver } from '@nuxt/kit'

// Dedicated fixture proving route/build invariants and content-only
// localization without @nuxtjs/i18n or @nuxtjs/sitemap. The environment
// toggle exercises both sitemap modes without a second fixture directory.
const sitemapDisabled = process.env.ROUTE_INVARIANTS_SITEMAP_DISABLED === '1'
const { resolve } = createResolver(import.meta.url)

export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },

  modules: [
    '@lupinum/ginko-content'
  ],

  content: {
    // Search is opt-in. This fixture asserts cross-artifact search
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
    // A custom transformer must affect query results and generated routes
    // identically, the same invariant already proven for
    // `content:file:beforeParse` hooks below. `word-count.ts` stamps a
    // computed `wordCount` fact onto every markdown document; `/nav` (a
    // direct query) and the transformed page's own generated route both
    // render it (see `test/e2e/generate-output.test.ts`).
    transformers: [resolve('./transformers/word-count')]
  },

  site: {
    url: 'https://route-invariants.example.test',
    name: 'Ginko Content Route Invariants Fixture'
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
