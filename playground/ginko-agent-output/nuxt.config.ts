export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },

  modules: [
    '@lupinum/ginko-content',
    '@nuxtjs/i18n'
  ],

  content: {
    agent: {
      linkHeaders: true,
      markdownNegotiation: true
    },
    // Nuxt I18n (configured below) is the sole locale/default-locale
    // authority (VNEXT.md §12.1). Ginko content still owns translated-slug
    // policy.
    i18n: {
      translatedSlugs: true
    }
  },

  routeRules: {
    '/ssr-only': { prerender: false }
  },

  i18n: {
    baseUrl: 'https://agent-output.example.test',
    strategy: 'prefix_except_default',
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
