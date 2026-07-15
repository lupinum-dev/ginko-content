import { resolve } from 'node:path'
import type { Nuxt } from '@nuxt/schema'
import { defu } from 'defu'
import { join } from 'pathe'
import { withTrailingSlash } from 'ufo'
import type { ContentConfig } from '../types/config'
import type { ContentContext, ModuleOptions, ResolvedContentContext } from '../types/module'
import { useContentMounts } from '../utils'
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

interface ContentNitroConfigLogger {
  warn: (message: string) => void
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
  logger: ContentNitroConfigLogger
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
  getSearchRuntime,
  logger
}: ContentNitroConfigOptions) => {
  hookNuxtBoundary(nuxt, 'nitro:config', (nitroConfig: Record<string, any>) => {
    const searchRuntime = getSearchRuntime()
    nitroConfig.prerender = nitroConfig.prerender || {}
    nitroConfig.prerender.routes = nitroConfig.prerender.routes || []

    const usesFilesystemProvider = !contentContext.provider || contentContext.provider === 'filesystem'
    // Matches `module/server-handlers.ts`'s route registration exactly (dev
    // has no build integrity suffix; the cache/build route is otherwise only
    // ever unshifted into the non-dev prerender route list below).
    const cacheRoute = nuxt.options.dev
      ? `${options.api.baseURL}/cache.json`
      : `${options.api.baseURL}/cache.${buildIntegrity}.json`

    if (!nuxt.options.dev) {
      nitroConfig.prerender.routes.unshift(cacheRoute)
      // The cache/build route's HTML response (see
      // `runtime/server/api/cache.ts`) seeds content-route prerender
      // injection via Nitro's own crawl-links mechanism.
      // This is the only viable injection point for BOTH static (`nuxi
      // generate`) and non-static (`nuxi build`) presets: Nitro's own
      // `prerender()` finalizes its crawl queue from
      // `nitro.options.prerender.routes` before the compiled main Nitro
      // instance's own `'compiled'` hook ever fires for a non-static build
      // (confirmed empirically — Nuxt's hybrid build only compiles a
      // request-servable main bundle of its own AFTER prerendering
      // completes), so a build hook has no earlier, reliable way to push
      // additional routes into that queue. Enabling `crawlLinks` here means
      // a hybrid build's prerender crawl also reaches ordinary app-owned
      // pages reachable by link from a prerendered page — not just content
      // routes — which is reflected in the updated `build` lane goldens.
      if (nitroConfig.prerender.crawlLinks === false) {
        // The user explicitly opted out of crawling in their own nuxt.config. Respect
        // that choice (least surprising) rather than silently forcing it back on, but
        // warn loudly: without crawling, filesystem content routes never reach the
        // prerender queue and the build will ship without them.
        logger.warn(
          'content module needs `nitro.prerender.crawlLinks` to inject provider content routes into the prerender queue, but it is explicitly set to `false` in your nuxt.config. Content routes will NOT be prerendered until you remove `crawlLinks: false`.'
        )
      }
      nitroConfig.prerender.crawlLinks = nitroConfig.prerender.crawlLinks ?? true
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
        resolveModuleFile('.'),
        ...runtimeInlineDependencies
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
      cacheRoute,
      sitemapPrerenderRoutes: () => contentContext.sitemap === false ? [] : resolveNuxtSitemapPrerenderRoutes(nuxt),
      resolveContentContext: () => {
        const resolved = getResolvedContentContext()
        return { sitemap: resolved.sitemap, provider: resolved.provider }
      }
    }, {
      sitemap: contentContext.sitemap,
      provider: contentContext.provider
    })

    const agentRoutes = normalizeAgentRouteOptions(options)
    if (agentRoutes.routes && agentRoutes.prerender && appContentConfig.agent) {
      nitroConfig.prerender.routes.push('/llms.txt', '/llms-full.txt')
      for (const locale of resolvedI18n.locales || []) {
        if (locale && locale !== resolvedI18n.defaultLocale) {
          nitroConfig.prerender.routes.push(`/${locale}/llms.txt`, `/${locale}/llms-full.txt`)
        }
      }
    }
  })
}
