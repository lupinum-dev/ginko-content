import { defineNitroPlugin } from 'nitropack/runtime'
import { getContentRuntimeConfig } from '../runtime-config'
import { GINKO_SITEMAP_SOURCE_NAME, resolveContentSitemapSource } from '../../utils/sitemap-source'

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

export default defineNitroPlugin((nitro) => {
  ;(nitro.hooks.hook as any)('sitemap:sources', (ctx: SitemapSourcesHookContext) => {
    const runtimeConfig = getContentRuntimeConfig()
    const sitemap = runtimeConfig.content?.sitemap
    const apiBaseURL = runtimeConfig.content?.api?.baseURL

    if (!sitemap || !apiBaseURL) {
      return
    }

    const fetch = resolveContentSitemapSource(apiBaseURL, sitemap.path || '/sitemap')

    ctx.sources = ctx.sources.filter((source) => {
      return source.context?.name !== GINKO_SITEMAP_SOURCE_NAME
    })

    ctx.sources.push({
      context: {
        name: GINKO_SITEMAP_SOURCE_NAME
      },
      fetch,
      sourceType: 'app'
    })
  })
})
