export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  extends: ['../shared'],

  modules: [
    '@lupinum/ginko-content',
    '@nuxtjs/i18n',
    '@nuxtjs/sitemap'
  ],

  content: {
    i18n: {
      defaultLocale: 'en',
      locales: ['en', 'de'],
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
        requiredPaths: ['/guide/getting-started', '/de/leitfaden/erste-schritte'],
        forbiddenPathPrefixes: ['/authors/evan', '/guide/draft-roadmap', '/de/leitfaden/entwurf']
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
