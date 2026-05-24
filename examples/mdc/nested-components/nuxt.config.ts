export default defineNuxtConfig({
  modules: [
    '@lupinum/ginko-content',
    '@nuxt/ui'
  ],
  components: [{
    path: '~/components',
    global: true
  }]
})
