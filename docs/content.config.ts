import { defineGinkoDocsConfig } from '@lupinum/ginko-docs/content'

const config = defineGinkoDocsConfig({
  site: {
    name: 'Ginko Content',
    description: 'Filesystem-first content for Nuxt sites with coherent routes, types, localization, search, SEO, and agent output.',
    url: 'https://ginko-content.lupinum.com'
  },
  locales: ['en'],
  blog: false
})

const { url: _legacyUrl, ...agentSite } = config.agent.site

export default {
  ...config,
  agent: {
    ...config.agent,
    site: {
      ...agentSite,
      whenToUse: 'Use this site to learn, configure, and operate Ginko Content.',
      whenNotToUse: 'Do not use this site as documentation for Nuxt Content.'
    }
  }
}
