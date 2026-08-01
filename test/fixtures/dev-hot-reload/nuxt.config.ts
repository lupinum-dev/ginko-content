import { randomUUID } from 'node:crypto'

export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  devtools: { enabled: false },
  modules: ['@lupinum/ginko-content'],
  content: {
    agent: false,
    search: false,
    sitemap: false
  },
  runtimeConfig: {
    public: {
      devBootId: randomUUID()
    }
  },
  compatibilityDate: '2026-04-14'
})
