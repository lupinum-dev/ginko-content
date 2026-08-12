import { defineGinkoDocsConfig } from '@lupinum/ginko-docs/content'

export default defineGinkoDocsConfig({
  site: {
    name: 'Ginko Content',
    description: 'Filesystem-first content for Nuxt sites with coherent routes, types, localization, search, SEO, and agent output.',
    url: 'https://ginko-content.lupinum.com'
  },
  locales: ['en'],
  blog: false
})
