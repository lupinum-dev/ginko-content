import { useNuxt } from 'nuxt/kit'
import type { NuxtConfig } from 'nuxt/schema'

const siteUrl = 'https://ginko-content.nuxt.dev'
const publicSansFonts = {
  defaults: {
    formats: ['woff'],
    weights: [400, 500, 600, 700],
    styles: ['normal'],
    subsets: ['latin']
  },
  families: [{ name: 'Public Sans', provider: 'local', global: true }],
  provider: 'local'
} satisfies NonNullable<NuxtConfig['fonts']>

export default defineNuxtConfig({
  extends: ['@lupinum/ginko-docs'],
  hooks: {
    // Nuxt layers concatenate arrays, but a provider override must replace the
    // layer's Google family before @nuxt/fonts resolves it.
    'modules:before': () => { useNuxt().options.fonts = publicSansFonts }
  },
  site: { url: siteUrl },
  i18n: {
    baseUrl: siteUrl,
    locales: [{ code: 'en', language: 'en-US', name: 'English' }]
  },
  components: [{ path: '~/components/mdc', global: true }],
  css: ['~/assets/main.css'],
  fonts: publicSansFonts,
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
