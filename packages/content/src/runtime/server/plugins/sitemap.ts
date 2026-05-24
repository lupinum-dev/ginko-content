import { defineNitroPlugin } from 'nitropack/runtime'
import { getContentRuntimeConfig } from '../runtime-config'

type SitemapSource = {
  context?: {
    name?: string
  }
  fetch?: string
  sourceType?: string
}

type SitemapSourcesHookContext = {
  sources: SitemapSource[]
}

const LEGACY_NUXT_CONTENT_V2_SOURCE = '@nuxt/content@v2:urls'
const GINKO_SOURCE = '@lupinum/ginko-content:urls'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('sitemap:sources', (ctx: SitemapSourcesHookContext) => {
    const runtimeConfig = getContentRuntimeConfig()
    const sitemap = runtimeConfig.public.content?.sitemap
    const apiBaseURL = runtimeConfig.public.content?.api?.baseURL

    if (!sitemap || !apiBaseURL) {
      return
    }

    const fetch = `${apiBaseURL}${sitemap.path || '/sitemap'}`

    // Nuxt Sitemap can auto-register the upstream Nuxt Content v2 adapter.
    // Ginko owns its source explicitly, so remove the legacy source when it appears.
    ctx.sources = ctx.sources.filter((source) => {
      return source.context?.name !== LEGACY_NUXT_CONTENT_V2_SOURCE && source.context?.name !== GINKO_SOURCE
    })

    ctx.sources.push({
      context: {
        name: GINKO_SOURCE
      },
      fetch,
      sourceType: 'app'
    })
  })
})
