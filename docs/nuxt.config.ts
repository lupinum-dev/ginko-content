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
