import {
  createResolver,
  defineNuxtModule,
  addTemplate,
  useLogger
} from '@nuxt/kit'
import { defu } from 'defu'
import { name, version } from '../package.json'
import type { ContentContext, ModuleOptions, ResolvedContentContext } from './types/module'
import { loadContentConfig, resolveContentConfigPath } from './utils/content-config'
import { createVirtualContentTemplates, registerVirtualContentAliases } from './module/virtual'
import { registerContentDevRuntime } from './module/dev'
import { registerContentI18nTemplate, registerGeneratedTypes, registerRuntimeComponents, registerRuntimeImports, registerUserContentComponents, registerDevRuntimePlugin } from './module/runtime-assets'
import { registerContentServerHandlers } from './module/server-handlers'
import { registerContentComponentsTemplate } from './module/content-components-template'
import { resolveCollectionI18nConfig } from './features/localization/config'
import { collectSitemapCollectionRouteCounts } from './module/integration-hooks'
import {
  createSitemapAssertionTargetsFromPrerenderedSitemaps,
  shouldRunSitemapAssertionOnPrerenderedSitemaps,
  assertGeneratedSitemaps
} from './module/sitemap-assert'
import { configureNuxtSitemapSource, createSearchRuntimeConfig, hasNuxtI18nModule, normalizeSearchOptions, normalizeSitemapOptions, resolveModuleI18nOptions } from './module/options'
import { validateContentPageRouteMetadata } from './module/route-meta-validation'
import { hasAgentSurface, validateAgentConfig } from './module/agent-config'
import { registerStaticOutputGeneration } from './module/static-output'
import { registerContentNitroConfig } from './module/nitro-config'
import { validateCollectionNames, validateRemovedMarkdownOptions } from './module/validation'
import { contentModuleDefaults } from './module/defaults'
import './module/augmentations'
import { registerContentContextFinalization } from './module/context-finalization'

const hookNuxtBoundary = <T>(
  nuxt: { hook: unknown },
  name: string,
  callback: (payload: T) => void | Promise<void>
) => {
  const hook = nuxt.hook as (hookName: string, callback: (payload: T) => void | Promise<void>) => void
  hook(name, callback)
}

export { agentMetadataFields, defineAgentAppPage, defineAgentMarkdownPolicy, defineAgentMetadataFields, defineAgentSection, defineCollection, defineContentConfig, reference } from './types/config.js'
export type * from './types'

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name,
    version,
    configKey: 'content',
    compatibility: {
      nuxt: '>=4.0.0'
    }
  },
  moduleDependencies: {
    '@nuxt/ui': {
      optional: true,
      defaults: {
        content: true,
        prose: true
      }
    }
  },
  defaults: contentModuleDefaults,
  async setup (options, nuxt) {
    const { resolve, resolvePath } = createResolver(import.meta.url)
    const logger = useLogger(name)
    const resolveRuntimeModule = (path: string) => resolve('./runtime', path)
    const runtimeInlineDependencies = ['comark', '@comark/vue']
    validateRemovedMarkdownOptions(options)
    nuxt.options.experimental.payloadExtraction ??= false
    nuxt.options.build.transpile ||= []
    for (const dependency of runtimeInlineDependencies) {
      if (!nuxt.options.build.transpile.includes(dependency)) {
        nuxt.options.build.transpile.push(dependency)
      }
    }
    nuxt.options.vite = nuxt.options.vite || {}
    nuxt.options.vite.ssr = defu(nuxt.options.vite.ssr || {}, {
      noExternal: runtimeInlineDependencies
    })
    const contentConfigPath = resolveContentConfigPath(nuxt)
    const appContentConfig = await loadContentConfig(nuxt)
    const externalGinkoContentConfig = (nuxt.options as any).ginkoContent
    if (externalGinkoContentConfig?.agent && options.agent !== false) {
      options.agent = defu(options.agent || {}, externalGinkoContentConfig.agent)
    }
    if (!contentConfigPath || !appContentConfig.collections || !Object.keys(appContentConfig.collections).length) {
      throw new Error('@lupinum/ginko-content requires a content.config.ts with at least one collection. Define collections with defineContentConfig({ collections: { ... } }).')
    }
    const resolvedI18n = resolveModuleI18nOptions(options, nuxt)
    const resolvedSitemap = normalizeSitemapOptions(options)
    const resolvedSearch = normalizeSearchOptions(options)

    validateCollectionNames(appContentConfig.collections)
    if (!hasAgentSurface(appContentConfig)) {
      options.agent = false
    }
    validateAgentConfig(appContentConfig, options, { dev: nuxt.options.dev })

    options.collections = Object.fromEntries(Object.entries(appContentConfig.collections).map(([name, collection]) => [
      name,
      {
        ...collection,
        i18n: resolveCollectionI18nConfig(
          collection,
          resolvedI18n.defaultLocale && resolvedI18n.locales.length
            ? { defaultLocale: resolvedI18n.defaultLocale, locales: resolvedI18n.locales }
            : undefined,
          { warnMissingGlobal: true }
        )
      }
    ]))
    options.provider = appContentConfig.provider || options.provider || 'filesystem'
    const providerRegistry = {
      ...(options.providers || {}),
      ...(appContentConfig.providers || {})
    }
    options.providers = providerRegistry
    // Disable cache in dev mode
    const buildIntegrity = nuxt.options.dev ? undefined : Date.now()

    const contentContext: ContentContext = {
      ...options,
      transformers: [],
      locales: resolvedI18n.locales,
      defaultLocale: resolvedI18n.defaultLocale,
      localeFallback: resolvedI18n.fallback,
      translatedSlugs: resolvedI18n.translatedSlugs,
      strictTranslatedSlugs: resolvedI18n.strictTranslatedSlugs,
      sitemap: resolvedSitemap,
      search: resolvedSearch
    }
    let resolvedContentContext: ResolvedContentContext | undefined
    const getResolvedContentContext = () => {
      if (!resolvedContentContext) {
        throw new Error('Content runtime config was read before content context resolution completed.')
      }
      return resolvedContentContext
    }

    if (resolvedSitemap !== false) {
      configureNuxtSitemapSource(nuxt, options.api.baseURL, resolvedSitemap.path)
    }
    nuxt.hook('pages:extend', (pages) => {
      validateContentPageRouteMetadata(pages, options.collections || {}, {
        locales: resolvedI18n.locales,
        defaultLocale: resolvedI18n.defaultLocale
      })
    })
    if (resolvedSitemap && resolvedSitemap.assert.enabled) {
      // Validate the final XML files through Nuxt Sitemap's own hook. Nitro's lower-level build
      // hooks can run before locale child sitemaps exist, which is what caused the earlier false
      // positives and the temptation to paper over things with app-owned prerender route lists.
      hookNuxtBoundary(nuxt, 'sitemap:prerender:done', async ({ sitemaps }: {
        sitemaps: Array<{ name: string, content: string }>
      }) => {
        const assertOptions = resolvedSitemap ? resolvedSitemap.assert : undefined
        if (!assertOptions || !shouldRunSitemapAssertionOnPrerenderedSitemaps(assertOptions)) {
          return
        }

        await assertGeneratedSitemaps({
          options: assertOptions,
          targets: createSitemapAssertionTargetsFromPrerenderedSitemaps(sitemaps),
          collectionRouteCounts: await collectSitemapCollectionRouteCounts(nuxt.options.rootDir, getResolvedContentContext()),
          logger
        })
      })
    }
    const { transformersTemplate, virtualConfigTemplate, virtualProvidersTemplate, virtualCacheAdapterTemplate } = createVirtualContentTemplates(contentContext, nuxt, contentConfigPath, addTemplate)
    registerVirtualContentAliases(nuxt, transformersTemplate, virtualConfigTemplate, virtualProvidersTemplate, virtualCacheAdapterTemplate, resolveRuntimeModule)
    registerContentServerHandlers(nuxt, options, resolveRuntimeModule, buildIntegrity)
    registerContentI18nTemplate(addTemplate, hasNuxtI18nModule(nuxt.options.modules))
    registerRuntimeImports(resolveRuntimeModule)
    registerRuntimeComponents(resolve)
    registerContentComponentsTemplate(addTemplate)
    registerGeneratedTypes(
      contentConfigPath,
      resolveRuntimeModule,
      Object.keys(appContentConfig.collections),
      Object.entries(appContentConfig.collections).filter(([, collection]) => Boolean(collection.i18n)).map(([name]) => name)
    )
    await registerUserContentComponents(nuxt, resolve)
    const getSearchRuntime = () => contentContext.search === false
      ? false
      : createSearchRuntimeConfig(contentContext.search, options.api.baseURL)
    registerContentNitroConfig({
      nuxt,
      options,
      appContentConfig,
      contentContext,
      runtimeInlineDependencies,
      buildIntegrity,
      resolvedI18n,
      resolveRuntimeModule,
      resolveModuleFile: resolve,
      getResolvedContentContext,
      getSearchRuntime
    })
    registerStaticOutputGeneration({
      nuxt,
      options,
      appContentConfig,
      contentContext,
      resolvedI18n,
      resolveRuntimeModule,
      getSearchRuntime
    })
    registerContentContextFinalization({
      nuxt,
      options,
      appContentConfig,
      contentContext,
      buildIntegrity,
      resolvePath,
      resolveRuntimeModule,
      onResolved: context => {
        resolvedContentContext = context
      }
    })

    if (nuxt.options.dev) {
      registerDevRuntimePlugin(resolveRuntimeModule)
      registerContentDevRuntime(nuxt, options, contentContext)
    }
  }
})

export interface ModuleHooks {
  'content:providers'(providers: Record<string, string>): void | Promise<void>
  'content:context'(ctx: ContentContext): void | Promise<void>
}
