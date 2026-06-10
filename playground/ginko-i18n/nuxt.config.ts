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
        routes: ['/guide/getting-started', '/de/leitfaden/erste-schritte'],
        forbidden: ['/authors/evan', '/guide/draft-roadmap', '/de/leitfaden/entwurf']
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
