export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  extends: ['../shared'],

  modules: [
    '@lupinum/ginko-content'
  ],

  // Search is intentionally opt-in. This production fixture exercises the
  // generated index and runtime search endpoints, so enable MiniSearch here.
  content: {
    search: {}
  },

  compatibilityDate: '2026-04-14'
})
