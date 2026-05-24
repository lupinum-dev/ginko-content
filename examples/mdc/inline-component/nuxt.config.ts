export default defineNuxtConfig({
  modules: [
    '@lupinum/ginko-content',
    '@nuxt/ui'
  ],
  content: {
    markdown: {
      plugins: [
        ['highlight', {
          theme: 'one-dark-pro'
        }],
        ['toc', { depth: 2, searchDepth: 2 }],
        'summary'
      ]
    }
  }
})
