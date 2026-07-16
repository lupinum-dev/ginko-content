const siteUrl = 'https://ginko-content.nuxt.dev'

export default defineNuxtConfig({
  extends: ['@lupinum/ginko-docs'],
  site: { url: siteUrl },
  i18n: {
    baseUrl: siteUrl,
    locales: [{ code: 'en', language: 'en-US', name: 'English' }]
  },
  components: [{ path: '~/components/mdc', global: true }],
  css: ['~/assets/main.css'],
  vite: {
    resolve: {
      // The packed docs layer depends on this workspace package too. Resolve
      // both imports to one instance so layer subpath imports stay coherent.
      dedupe: ['@lupinum/ginko-content']
    }
  },
  content: {
    componentPolicy: {
      components: {
        'feature-panel': {
          kind: 'block',
          props: {
            title: { type: 'string', required: false }
          },
          slots: ['default'],
          media: null
        }
      }
    },
    markdown: {
      tags: {
        'feature-panel': 'MdcFeaturePanel'
      }
    }
  },
  app: {
    head: {
      title: 'Ginko Content',
      meta: [
        {
          name: 'description',
          content: 'Filesystem-first content for Nuxt sites with coherent routes, types, localization, search, SEO, and agent output.'
        }
      ]
    }
  },
  compatibilityDate: '2025-07-15'
})
