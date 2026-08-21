export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  modules: [
    '@lupinum/ginko-content',
    '@nuxtjs/i18n'
  ],
  i18n: {
    locales: [
      { code: 'en', language: 'en-US' },
      { code: 'de', language: 'de-DE' }
    ],
    defaultLocale: 'en',
    strategy: 'prefix_except_default'
  },
  content: {
    i18n: {
      fallback: {
        de: ['en']
      }
    }
  }
})
