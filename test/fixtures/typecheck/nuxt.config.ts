export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  modules: ['@lupinum/ginko-content'],
  content: {
    i18n: {
      defaultLocale: 'en',
      locales: ['en', 'de']
    }
  },
  compatibilityDate: '2026-04-15'
})
