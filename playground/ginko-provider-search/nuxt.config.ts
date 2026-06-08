export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },

  modules: [
    '@lupinum/ginko-content',
    '@nuxtjs/sitemap'
  ],

  content: {
    i18n: false,
    search: {
      engine: 'cms',
      collections: ['docs']
    },
    sitemap: true
  },

  site: {
    url: 'https://provider-content.example.test',
    name: 'Provider Content Fixture'
  },

  compatibilityDate: '2026-04-14'
})
