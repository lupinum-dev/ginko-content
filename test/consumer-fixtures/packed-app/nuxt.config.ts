export default defineNuxtConfig({
        modules: ['@lupinum/ginko-content', '@nuxtjs/sitemap'],
        site: {
          url: 'https://packed-consumer.example.test',
          name: 'Packed Consumer'
        },
        routeRules: {
          '/cache-live': { prerender: false }
        },
        content: {
          cache: '~/server/content-cache',
          agent: {
            linkHeaders: true,
            delivery: 'runtime'
          },
          search: {
            engine: 'provider'
          },
          sitemap: true,
          validation: 'report'
        },
        compatibilityDate: '2026-04-14'
      })
    
