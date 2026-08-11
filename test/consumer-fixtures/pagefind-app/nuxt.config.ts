export default defineNuxtConfig({
        modules: ['@lupinum/ginko-content'],
        content: {
          agent: false,
          search: { engine: 'pagefind' },
          sitemap: false,
          validation: 'report'
        },
        compatibilityDate: '2026-04-14'
      })
    
