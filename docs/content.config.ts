import { defineGinkoDocsConfig } from '@lupinum/ginko-docs/content'

export default defineGinkoDocsConfig({
  site: {
    name: 'Ginko Content',
    description: 'Filesystem-first content for Nuxt sites with coherent routes, types, localization, search, SEO, and agent output.',
    whenToUse: 'Use this site to learn, configure, and operate Ginko Content.'
  },
  locales: ['en'],
  blog: false
})
