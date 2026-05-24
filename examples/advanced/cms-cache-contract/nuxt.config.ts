export default defineNuxtConfig({
  modules: [
    '@lupinum/ginko-content',
    '@nuxt/ui'
  ],
  content: {
    cache: '~/server/content-cache',
    revalidate: {
      token: process.env.GINKO_CONTENT_REVALIDATE_TOKEN || 'local-revalidate-secret'
    }
  }
})
