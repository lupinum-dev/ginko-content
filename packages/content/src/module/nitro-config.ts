import { resolve } from 'node:path'
import type { Nuxt } from '@nuxt/schema'
import { defu } from 'defu'
import { join } from 'pathe'
import { withTrailingSlash } from 'ufo'
import type { ContentConfig } from '../types/config'
import type { ContentContext, ModuleOptions, ResolvedContentContext } from '../types/module'
import { processMarkdownOptions, useContentMounts } from '../utils'
import { normalizeAgentRouteOptions } from './agent-options'
import { registerContentNitroIntegrationHooks } from './integration-hooks'
import type { createSearchRuntimeConfig } from './options'
import { resolveNuxtSitemapPrerenderRoutes } from './options'

type SearchRuntime = ReturnType<typeof createSearchRuntimeConfig> | false

const hookNuxtBoundary = <T>(
  nuxt: { hook: unknown },
  name: string,
  callback: (payload: T) => void | Promise<void>
) => {
  const hook = nuxt.hook as (hookName: string, callback: (payload: T) => void | Promise<void>) => void
  hook(name, callback)
}

interface ContentNitroConfigOptions {
  nuxt: Nuxt
  options: ModuleOptions
  appContentConfig: ContentConfig
  contentContext: ContentContext
  runtimeInlineDependencies: string[]
  buildIntegrity: number | undefined
  resolvedI18n: Pick<ContentContext, 'locales' | 'defaultLocale'>
  resolveRuntimeModule: (path: string) => string
  resolveModuleFile: (path: string) => string
  getResolvedContentContext: () => ResolvedContentContext
  getSearchRuntime: () => SearchRuntime
}

export const registerContentNitroConfig = ({
  nuxt,
  options,
  appContentConfig,
  contentContext,
  runtimeInlineDependencies,
  buildIntegrity,
  resolvedI18n,
  resolveRuntimeModule,
  resolveModuleFile,
  getResolvedContentContext,
  getSearchRuntime
}: ContentNitroConfigOptions) => {
  hookNuxtBoundary(nuxt, 'nitro:config', (nitroConfig: Record<string, any>) => {
    const searchRuntime = getSearchRuntime()
    nitroConfig.prerender = nitroConfig.prerender || {}
    nitroConfig.prerender.routes = nitroConfig.prerender.routes || []

    const usesFilesystemProvider = !contentContext.provider || contentContext.provider === 'filesystem'

    if (!nuxt.options.dev && usesFilesystemProvider) {
      nitroConfig.prerender.routes.unshift(`${options.api.baseURL}/cache.${buildIntegrity}.json`)
    }

    const sources = useContentMounts(nuxt, contentContext.sources)
    nitroConfig.devStorage = Object.assign(nitroConfig.devStorage || {}, sources)
    nitroConfig.devStorage['cache:content'] = {
      driver: 'fs',
      base: resolve(nuxt.options.buildDir, 'content-cache')
    }

    // Tell Nuxt to ignore content dir for app build.
    for (const source of Object.values(sources)) {
      if (source.driver === 'fs' && typeof source.base === 'string' && source.base.includes(nuxt.options.srcDir)) {
        const wildcard = join(source.base, '**/*').replace(withTrailingSlash(nuxt.options.srcDir), '')
        nuxt.options.ignore.push(wildcard, `!${wildcard}.vue`)
      }
    }
    nitroConfig.bundledStorage = nitroConfig.bundledStorage || []
    nitroConfig.bundledStorage.push('cache:content')

    nitroConfig.externals = defu(typeof nitroConfig.externals === 'object' ? nitroConfig.externals : {}, {
      inline: [
        resolveModuleFile('./runtime'),
        ...runtimeInlineDependencies
      ]
    })
    if (searchRuntime !== false && searchRuntime.engine !== 'cms' && usesFilesystemProvider) {
      nitroConfig.routeRules = nitroConfig.routeRules || {}
      nitroConfig.routeRules[searchRuntime.indexURL] = {
        prerender: true,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    }
    if (contentContext.sitemap !== false) {
      nitroConfig.plugins ||= []
      // Ginko swaps Nuxt Sitemap's upstream Nuxt Content v2 source through the official
      // `sitemap:sources` runtime hook instead of patching Sitemap's generated virtual modules.
      const sitemapPlugin = resolveRuntimeModule('server/plugins/sitemap.js')
      if (!nitroConfig.plugins.includes(sitemapPlugin)) {
        nitroConfig.plugins.push(sitemapPlugin)
      }
    }
    if (contentContext.cache) {
      nitroConfig.plugins ||= []
      const cachePlugin = resolveRuntimeModule('server/plugins/cache.js')
      if (!nitroConfig.plugins.includes(cachePlugin)) {
        nitroConfig.plugins.push(cachePlugin)
      }
    }

    registerContentNitroIntegrationHooks(nitroConfig, {
      rootDir: nuxt.options.rootDir,
      sitemapPrerenderRoutes: () => contentContext.sitemap === false ? [] : resolveNuxtSitemapPrerenderRoutes(nuxt),
      resolveContentContext: getResolvedContentContext
    }, {
      collections: contentContext.collections,
      locales: contentContext.locales,
      defaultLocale: contentContext.defaultLocale,
      translatedSlugs: contentContext.translatedSlugs,
      respectPathCase: contentContext.respectPathCase,
      markdown: processMarkdownOptions(contentContext.markdown),
      yaml: contentContext.yaml,
      csv: contentContext.csv,
      sitemap: contentContext.sitemap,
      provider: contentContext.provider
    })

    const agentRoutes = normalizeAgentRouteOptions(options)
    if (agentRoutes.routes && agentRoutes.prerender && appContentConfig.agent) {
      nitroConfig.prerender.routes.push('/llms.txt', '/llms-full.txt')
      for (const locale of appContentConfig.agent.site?.locales || resolvedI18n.locales || []) {
        if (locale && locale !== (appContentConfig.agent.site?.defaultLocale || resolvedI18n.defaultLocale)) {
          nitroConfig.prerender.routes.push(`/${locale}/llms.txt`, `/${locale}/llms-full.txt`)
        }
      }
    }
  })
}
