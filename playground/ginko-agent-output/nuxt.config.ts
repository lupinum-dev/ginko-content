import type { PortableComponentPolicyV1 } from '@lupinum/ginko-content/cms-contract'

const componentPolicy = {
  components: {
    callout: {
      kind: 'block',
      props: { title: { type: 'string', required: false } },
      slots: ['default'],
      media: null
    },
    card: {
      kind: 'block',
      props: {
        title: { type: 'string', required: false },
        to: { type: 'string', required: false }
      },
      slots: ['default'],
      media: null
    },
    gallery: {
      kind: 'block',
      props: {
        layout: { type: 'string', required: false },
        caption: { type: 'string', required: false }
      },
      slots: ['default'],
      media: null
    },
    chart: { kind: 'block', props: {}, slots: ['default'], media: null },
    'consent-embed': {
      kind: 'block',
      props: { category: { type: 'string', required: false } },
      slots: ['default'],
      media: null
    },
    'unknown-widget': { kind: 'block', props: {}, slots: ['default'], media: null }
  }
} satisfies PortableComponentPolicyV1

export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },

  modules: [
    '@lupinum/ginko-content',
    '@nuxtjs/i18n'
  ],

  content: {
    componentPolicy,
    agent: {
      linkHeaders: true,
      markdownNegotiation: true
    },
    // Nuxt I18n (configured below) is the sole locale/default-locale
    // authority. Ginko content still owns translated-slug
    // policy.
    i18n: {
      translatedSlugs: true
    }
  },

  routeRules: {
    '/ssr-only': { prerender: false }
  },

  i18n: {
    baseUrl: 'https://agent-output.example.test',
    strategy: 'prefix_except_default',
    defaultLocale: 'en',
    detectBrowserLanguage: false,
    locales: [
      { code: 'en', language: 'en-US', name: 'English' },
      { code: 'de', language: 'de-DE', name: 'Deutsch' }
    ],
    vueI18n: './i18n.config.ts'
  },

  compatibilityDate: '2026-04-14'
})
