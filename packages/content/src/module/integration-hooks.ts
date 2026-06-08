import type { NitroConfig } from 'nitropack'
import type { ResolvedContentContext } from '../types/module'
import {
  assertGeneratedSitemaps,
  shouldRunSitemapAssertionOnCompiled
} from './sitemap-assert'
import { collectDerivedPrerenderRoutes, collectSitemapCollectionRouteCounts } from './derived-route-discovery'

export { collectSitemapCollectionRouteCounts } from './derived-route-discovery'

type IntegrationContentContext = Pick<ResolvedContentContext, 'collections' | 'locales' | 'defaultLocale' | 'translatedSlugs' | 'respectPathCase' | 'markdown' | 'yaml' | 'csv' | 'sitemap' | 'provider'>

const appendHook = <T>(
  hooks: Record<string, ((arg: T) => unknown | Promise<unknown>) | Array<(arg: T) => unknown | Promise<unknown>>>,
  name: string,
  handler: (arg: T) => unknown | Promise<unknown>
) => {
  const existing = hooks[name]
  if (!existing) {
    hooks[name] = handler
    return
  }

  hooks[name] = Array.isArray(existing)
    ? [...existing, handler]
    : [existing, handler]
}

export const registerContentNitroIntegrationHooks = (
  nitroConfig: NitroConfig,
  options: {
    rootDir: string
    sitemapPrerenderRoutes?: string[] | (() => string[])
    resolveContentContext?: () => IntegrationContentContext
  },
  contentContext: IntegrationContentContext
) => {
  const getHookContentContext = () => {
    if (!options.resolveContentContext) {
      return contentContext
    }

    try {
      return options.resolveContentContext()
    }
    catch {
      // Nitro config can register hooks before Nuxt module finalization in tests and
      // some Nuxt lifecycle paths. Hook execution should use the resolved context
      // when available, with the registration context as the rebuildable fallback.
      return contentContext
    }
  }

  nitroConfig.hooks ||= {}
  if (contentContext.sitemap && contentContext.sitemap.assert?.enabled) {
    appendHook(nitroConfig.hooks as Record<string, any>, 'compiled', async (nitro: {
      options: { output: { publicDir: string }, static: boolean }
      logger?: { info: (message: string) => void }
    }) => {
      const hookContentContext = getHookContentContext()
      const hookUsesFilesystemProvider = !hookContentContext.provider || hookContentContext.provider === 'filesystem'
      const assertOptions = hookContentContext.sitemap ? hookContentContext.sitemap.assert as any : undefined
      if (!assertOptions || !shouldRunSitemapAssertionOnCompiled(assertOptions, nitro)) {
        return
      }

      try {
        await assertGeneratedSitemaps({
          outputPublicDir: nitro.options.output.publicDir,
          options: assertOptions,
          collectionRouteCounts: hookUsesFilesystemProvider
            ? await collectSitemapCollectionRouteCounts(options.rootDir, hookContentContext)
            : {},
          logger: nitro.logger
        })
      }
      catch (error: unknown) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          return
        }
        throw error
      }
    })
  }

  appendHook(nitroConfig.hooks as Record<string, any>, 'prerender:routes', async (routes: Set<string>) => {
    const hookContentContext = getHookContentContext()
    const hookUsesFilesystemProvider = !hookContentContext.provider || hookContentContext.provider === 'filesystem'
    if (hookUsesFilesystemProvider) {
      for (const route of await collectDerivedPrerenderRoutes(options.rootDir, hookContentContext)) {
        routes.add(route)
      }
    }
    const sitemapPrerenderRoutes = typeof options.sitemapPrerenderRoutes === 'function'
      ? options.sitemapPrerenderRoutes()
      : options.sitemapPrerenderRoutes || []
    for (const route of sitemapPrerenderRoutes) {
      routes.add(route)
    }
  })
}
