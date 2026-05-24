export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  extends: ['../shared'],

  modules: [
    '@lupinum/ginko-content',
    '@nuxtjs/i18n'
  ],

  content: {
    i18n: {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      fallback: {
        de: ['en']
      },
      translatedSlugs: true
    }
  },

  i18n: {
    baseUrl: 'https://ginko-content.localhost',
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
