export default defineNuxtConfig({
  modules: ['@lupinum/ginko-content'],
  css: ['katex/dist/katex.min.css'],
  content: {
    agent: false,
    markdown: {
      plugins: ['math', 'mermaid', '~/server/custom-markdown']
    },
    search: false,
    sitemap: false,
    validation: 'report'
  },
  compatibilityDate: '2026-04-14'
})
