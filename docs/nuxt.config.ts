import type { PortableComponentPolicyV1 } from '@lupinum/ginko-content/cms-contract'

const componentPolicy = {
  components: {
    'code-group': { kind: 'block', props: {}, slots: ['default'], media: null },
    'landing-feature': {
      kind: 'block',
      props: {
        title: { type: 'string', required: false },
        description: { type: 'string', required: false },
        icon: { type: 'string', required: false },
        to: { type: 'string', required: false }
      },
      slots: ['default'],
      media: null
    },
    'page-section-cta': { kind: 'block', props: {}, slots: ['default'], media: null },
    step: {
      kind: 'block',
      props: { title: { type: 'string', required: false } },
      slots: ['default'],
      media: null
    },
    tabs: {
      kind: 'block',
      props: { class: { type: 'string', required: false } },
      slots: ['default'],
      media: null
    },
    'tabs-item': {
      kind: 'block',
      props: {
        label: { type: 'string', required: false },
        icon: { type: 'string', required: false }
      },
      slots: ['default'],
      media: null
    },
    template: {
      kind: 'block',
      props: { name: { type: 'string', required: true } },
      slots: ['default'],
      media: null
    },
    'u-button': {
      kind: 'inline',
      props: {
        size: { type: 'string', required: false },
        to: { type: 'string', required: false },
        variant: { type: 'string', required: false },
        'trailing-icon': { type: 'string', required: false },
        color: { type: 'string', required: false }
      },
      slots: ['default'],
      media: null
    },
    'u-container': { kind: 'block', props: {}, slots: ['default'], media: null },
    'u-input-copy': {
      kind: 'inline',
      props: {
        value: { type: 'string', required: false },
        class: { type: 'string', required: false }
      },
      slots: ['default'],
      media: null
    },
    'u-page-grid': {
      kind: 'block',
      props: { class: { type: 'string', required: false } },
      slots: ['default'],
      media: null
    },
    'u-page-hero': {
      kind: 'block',
      props: {
        orientation: { type: 'string', required: false },
        ui: { type: 'json', required: false }
      },
      slots: ['default', 'headline', 'links', 'title'],
      media: null
    },
    'u-page-section': {
      kind: 'block',
      props: {
        orientation: { type: 'string', required: false },
        ui: { type: 'json', required: false }
      },
      slots: ['default', 'description', 'features', 'headline', 'links', 'title'],
      media: null
    }
  }
} satisfies PortableComponentPolicyV1

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/fonts',
    '@nuxt/ui',
    '@lupinum/ginko-content',
    '@nuxt/image',
    '@nuxt/scripts',
    'nuxt-og-image',
    'nuxt-llms'
  ],
  devtools: {
    enabled: true
  },
  css: ['~/assets/main.css'],
  fonts: {
    families: [
      { name: 'Public Sans', provider: 'google' },
      { name: 'Bungee', provider: 'google' }
    ]
  },
  site: {
    name: '@lupinum/ginko-content',
    url: 'https://ginko-content.nuxt.dev'
  },
  ogImage: {
    buildCache: true,
    security: {
      renderTimeout: 60000
    }
  },
  content: {
    componentPolicy,
    markdown: {
      plugins: [
        ['highlight', {
          langs: ['bash', 'diff', 'json', 'js', 'ts', 'html', 'css', 'vue', 'shell', 'mdc', 'md', 'yaml', 'sql', 'jsonc']
        }],
        ['toc', { depth: 2, searchDepth: 2 }],
        'summary'
      ]
    }
  },
  ui: {
    content: true,
    theme: {
      colors: ['primary', 'secondary', 'info', 'success', 'warning', 'error', 'important']
    }
  },
  routeRules: {
    '/': { prerender: true }
  },
  experimental: {
    asyncContext: true
  },
  compatibilityDate: '2025-02-11',
  nitro: {
    prerender: {
      crawlLinks: true,
      routes: ['/'],
      ignore: ['/_og/'],
      concurrency: 4,
      // For CF trailing slash issue
      autoSubfolderIndex: false
    }
  },
  typescript: {
    strict: false
  },
  llms: {
    domain: 'https://ginko-content.nuxt.dev',
    title: '@lupinum/ginko-content documentation for LLMs',
    description: 'Ginko is a filesystem-first, provider-neutral content engine for Nuxt.',
    full: {
      title: '@lupinum/ginko-content complete documentation',
      description: 'The complete documentation for Ginko.'
    }
  }
})
