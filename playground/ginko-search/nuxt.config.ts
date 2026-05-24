import { defineNuxtConfig } from 'nuxt/config'

const engine = (process.env.CONTENT_SEARCH_ENGINE as 'minisearch' | 'pagefind' | 'cms' | undefined) || 'minisearch'
const collections = process.env.CONTENT_SEARCH_COLLECTIONS
  ?.split(',')
  .map(item => item.trim())
  .filter(Boolean)
const searchDisabled = process.env.CONTENT_SEARCH_DISABLED === '1'
const contextApiBaseURL = process.env.CONTENT_SEARCH_CONTEXT_API_BASE_URL

export default defineNuxtConfig({
  future: { compatibilityVersion: 4 },
  extends: ['../shared'],
  modules: [
    '@lupinum/ginko-content',
    (_, nuxt) => {
      if (!contextApiBaseURL) {
        return
      }

      nuxt.hook('content:context', (ctx) => {
        if (ctx.search === false) {
          return
        }

        ctx.search = {
          ...ctx.search,
          apiBaseURL: contextApiBaseURL
        }
      })
    }
  ],
  nitro: {
    prerender: {
      ignore: ['/en', '/en/**', '/guide/getting-started', '/posts/roadmap']
    }
  },
  content: {
    i18n: false,
    search: searchDisabled
      ? false
      : {
          engine,
          ...(collections?.length ? { collections } : {})
        }
  }
})
