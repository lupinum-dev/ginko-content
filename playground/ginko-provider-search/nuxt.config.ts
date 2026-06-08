export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },

  modules: ['@lupinum/ginko-content'],

  content: {
    i18n: false,
    search: {
      engine: 'cms',
      collections: ['docs']
    }
  },

  compatibilityDate: '2026-04-14'
})
