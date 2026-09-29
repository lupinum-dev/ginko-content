import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Nuxt } from '@nuxt/schema'
import { defu } from 'defu'
import { join } from 'pathe'
import { withTrailingSlash } from 'ufo'
import type { ContentConfig } from '../types/config'
import type { ContentContext, ModuleOptions, ResolvedContentContext } from '../types/module'
import { useContentMounts } from '../utils'
import { contentCacheRoutePath } from './cache-route'
import { normalizeAgentRouteOptions } from './agent-options'
import { registerContentNitroIntegrationHooks } from './integration-hooks'
import type { createSearchRuntimeConfig } from './options'
import { normalizePrerenderOptions, resolveNuxtSitemapPrerenderRoutes } from './options'

type SearchRuntime = ReturnType<typeof createSearchRuntimeConfig> | false

const NUXT_NITRO_CACHE_DRIVER_SUFFIX = '/node_modules/@nuxt/nitro-server/dist/runtime/utils/cache-driver.mjs'

export const createNuxtWindowsCacheDriverResolver = (
  platform: NodeJS.Platform = process.platform,
  fromFileURL: (url: URL) => string = fileURLToPath
) => {
  if (platform !== 'win32') {
    return undefined
  }

  return {
    name: 'ginko-content:nuxt-windows-cache-driver',
    resolveId(id: string) {
      if (!id.startsWith('file:')) {
        return null
      }

      try {
        const url = new URL(id)
        if (
          url.protocol !== 'file:'
          || url.hostname !== ''
          || url.search !== ''
          || url.hash !== ''
          || !url.pathname.toLowerCase().endsWith(NUXT_NITRO_CACHE_DRIVER_SUFFIX)
        ) {
          return null
        }
        return fromFileURL(url)
      }
      catch {
        return null
      }
    }
  }
}

const hookNuxtBoundary = <T>(
  nuxt: { hook: unknown },
  name: string,
  callback: (payload: T) => void | Promise<void>
) => {
  const hook = nuxt.hook as (hookName: string, callback: (payload: T) => void | Promise<void>) => void
  hook(name, callback)
}

interface ContentNitroConfigLogger {
  warn: (message: string) => void
}

interface ContentNitroConfigOptions {
  nuxt: Nuxt
  options: ModuleOptions
  appContentConfig: ContentConfig
  contentContext: ContentContext
  buildIntegrity: number | undefined
  resolvedI18n: Pick<ContentContext, 'locales' | 'defaultLocale'>
  resolveRuntimeModule: (path: string) => string
  resolveModuleFile: (path: string) => string
  getResolvedContentContext: () => ResolvedContentContext
  getSearchRuntime: () => SearchRuntime
  logger: ContentNitroConfigLogger
}

export const registerContentNitroConfig = ({
  nuxt,
  options,
  appContentConfig,
  contentContext,
  buildIntegrity,
  resolvedI18n,
  resolveRuntimeModule,
  resolveModuleFile,
  getResolvedContentContext,
  getSearchRuntime,
  logger
}: ContentNitroConfigOptions) => {
  hookNuxtBoundary(nuxt, 'nitro:config', (nitroConfig: Record<string, any>) => {
    const searchRuntime = getSearchRuntime()
    const agentRoutes = normalizeAgentRouteOptions(options)
    const prerender = normalizePrerenderOptions(options)
    nitroConfig.prerender = nitroConfig.prerender || {}
    nitroConfig.prerender.routes = nitroConfig.prerender.routes || []

    const usesFilesystemProvider = !contentContext.provider || contentContext.provider === 'filesystem'
    const cacheRoute = contentCacheRoutePath(options.api.baseURL, {
      dev: nuxt.options.dev,
      integrity: buildIntegrity
    })

    if (!nuxt.options.dev) {
      // The cache/build route is always prerendered first: it builds and
      // publishes the production content snapshot. While prerendering it
      // returns the public content routes in Nitro's `x-nitro-prerender`
      // response header (see `runtime/server/api/cache.ts`), which Nitro
      // queues with or without `crawlLinks`, for static (`nuxi generate`)
      // and hybrid (`nuxi build`) presets alike. Module option `prerender`
      // and collection option `prerender` decide which routes it returns.
      nitroConfig.prerender.routes.unshift(cacheRoute)
      // Link crawling additionally prerenders application pages reachable
      // from prerendered pages. It stays the default for compatibility, and
      // `agent.delivery: 'runtime'` depends on it. Sites whose application
      // pages render live data opt out with `prerender: { crawlLinks: false }`.
      if (prerender.crawlLinks) {
        nitroConfig.prerender.crawlLinks = nitroConfig.prerender.crawlLinks ?? true
      }
      else if (agentRoutes.delivery === 'runtime' && nitroConfig.prerender.crawlLinks !== true) {
        logger.warn(
          'content.agent.delivery `runtime` retains page data dependencies through Nitro link crawling, but `content.prerender` turns crawling off. Pages that are not seeded as content routes keep no generated data.'
        )
      }
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

    const windowsCacheDriverResolver = createNuxtWindowsCacheDriverResolver()
    if (windowsCacheDriverResolver) {
      nitroConfig.rollupConfig ||= {}
      nitroConfig.rollupConfig.plugins ||= []
      nitroConfig.rollupConfig.plugins.push(windowsCacheDriverResolver)
    }

    nitroConfig.externals = defu(typeof nitroConfig.externals === 'object' ? nitroConfig.externals : {}, {
      inline: [
        resolveModuleFile('.'),
        // The generated virtual modules import authored app files (content.config.ts and
        // transformers). Nitro's dev server externalizes them by default, which hands raw
        // TypeScript to Node's ESM loader and fails on any import Node cannot resolve on its
        // own — extensionless relative imports, aliases. They must be bundled instead.
        withTrailingSlash(resolve(nuxt.options.buildDir, 'content'))
      ]
    })
    if (searchRuntime !== false && searchRuntime.engine !== 'provider' && usesFilesystemProvider) {
      nitroConfig.routeRules = nitroConfig.routeRules || {}
      nitroConfig.routeRules[searchRuntime.indexURL] = {
        prerender: true,
        headers: { 'Content-Type': 'application/json; charset=utf-8' }
      }
    }
    if (contentContext.sitemap !== false) {
      nitroConfig.plugins ||= []
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
      cacheRoute,
      removePrerenderedHtml: agentRoutes.delivery === 'runtime'
        && !('_generate' in nuxt.options && nuxt.options._generate === true),
      sitemapPrerenderRoutes: () => contentContext.sitemap === false ? [] : resolveNuxtSitemapPrerenderRoutes(nuxt),
      resolveContentContext: () => {
        const resolved = getResolvedContentContext()
        return { sitemap: resolved.sitemap, provider: resolved.provider }
      }
    }, {
      sitemap: contentContext.sitemap,
      provider: contentContext.provider
    })

    if (agentRoutes.routes && appContentConfig.agent) {
      nitroConfig.plugins ||= []
      const agentErrorsPlugin = resolveRuntimeModule('server/plugins/agent-errors.js')
      if (!nitroConfig.plugins.includes(agentErrorsPlugin)) {
        nitroConfig.plugins.push(agentErrorsPlugin)
      }
    }
    if (agentRoutes.routes && appContentConfig.agent) {
      nitroConfig.prerender.routes.push('/llms.txt', '/llms-full.txt')
      for (const locale of resolvedI18n.locales || []) {
        if (locale && locale !== resolvedI18n.defaultLocale) {
          nitroConfig.prerender.routes.push(`/${locale}/llms.txt`, `/${locale}/llms-full.txt`)
        }
      }
    }
  })
}
