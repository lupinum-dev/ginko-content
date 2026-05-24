export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  extends: ['../shared'],

  modules: [
    '@lupinum/ginko-content'
  ],

  compatibilityDate: '2026-04-14'
})