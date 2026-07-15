import {
  createResolver,
  defineNuxtModule,
  addTemplate,
  useLogger
} from '@nuxt/kit'
import { defu } from 'defu'
import { rm } from 'node:fs/promises'
import { resolve as resolveFilePath } from 'node:path'
import { name, version } from '../package.json'
import type { JsonValue } from './cms-contract/index'
import { buildResolvedContentContract, hashCanonicalJson } from './cms-contract/index'
import type { ContentContext, ModuleOptions, ResolvedContentContext } from './types/module'
import { loadContentConfig, resolveContentConfigPath } from './utils/content-config'
import { createVirtualContentTemplates, registerVirtualContentAliases } from './module/virtual'
import { registerContentDevRuntime } from './module/dev'
import { registerContentI18nTemplate, registerGeneratedTypes, registerRuntimeComponents, registerRuntimeImports, registerUserContentComponents, registerDevRuntimePlugin } from './module/runtime-assets'
import { registerContentServerHandlers } from './module/server-handlers'
import { registerContentComponentsTemplate } from './module/content-components-template'
import { resolveCollectionI18nConfig } from './features/localization/config'
import {
  createSitemapAssertionTargetsFromPrerenderedSitemaps,
  readPersistedSitemapCollectionCounts,
  shouldRunSitemapAssertionOnPrerenderedSitemaps,
  assertGeneratedSitemaps
} from './module/sitemap-assert'
import { assertPagefindAvailable, configureNuxtSitemapSource, createSearchRuntimeConfig, hasNuxtI18nModule, hasNuxtSitemapModule, normalizeSearchOptions, normalizeSitemapOptions, resolveContentLocalePolicy, toResolvedContentI18nOptions } from './module/options'
import { validateContentPageRouteMetadata } from './module/route-meta-validation'
import { hasAgentSurface, validateAgentConfig } from './module/agent-config'
import { registerStaticOutputGeneration } from './module/static-output'
import { registerContentNitroConfig } from './module/nitro-config'
import { validateCollectionNames, validateContentConfigOnlyOptions, validateRemovedMarkdownOptions } from './module/validation'
import { contentModuleDefaults } from './module/defaults'
import './module/augmentations'
import { registerContentContextFinalization } from './module/context-finalization'
import { createContentValidationRouteFacts } from './module/validation-routes'
import { collectContentValidationPublicAssets } from './module/validation-assets'

const hookNuxtBoundary = <T>(
  nuxt: { hook: unknown },
  name: string,
  callback: (payload: T) => void | Promise<void>
) => {
  const hook = nuxt.hook as (hookName: string, callback: (payload: T) => void | Promise<void>) => void
  hook(name, callback)
}

export { defineCollection, defineContentConfig, reference } from './types/config.js'
// Curated root-entry type surface (GC-4). The former wildcard type re-export
// leaked the entire internal type graph — including the retired fluent-builder
// types — through the package root. Keep this list minimal: the module options,
// the collection handle, and the canonical document/navigation/toc envelope types
// that docs, playgrounds, and examples actually import. The collection-map
// registries + `StrictParsedContent` stay because the generated app types
// (registerGeneratedTypes) import `StrictParsedContent` from this specifier and
// augment `ContentCollectionMap`/`ContentCollectionI18nMap` through it — dropping
// them un-narrows string collection-name queries. Package and type contracts
// exercise this facade directly.
export type {
  ContentCollectionHandle,
  ContentCollectionI18nMap,
  ContentCollectionMap,
  ContentNavigationItem,
  ModuleOptions,
  NavItem,
  ParsedContent,
  StrictParsedContent,
  Toc,
  TocLink
} from './types'

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name,
    version,
    configKey: 'content',
    compatibility: {
      // Matches the peerDependencies range in packages/content/package.json and the
      // versions actually exercised by .github/workflows/deps-canary.yml
      // (minimum-supported: nuxt 4.4.7, latest-supported: ^4.4.7). Do not widen this
      // without adding a canary lane that proves it.
      nuxt: '>=4.4.7 <5'
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
    validateContentConfigOnlyOptions(options)
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
    if (!contentConfigPath || !appContentConfig.collections || !Object.keys(appContentConfig.collections).length) {
      throw new Error('@lupinum/ginko-content requires a content.config.ts with at least one collection. Define collections with defineContentConfig({ collections: { ... } }).')
    }
    const localePolicy = resolveContentLocalePolicy(
      options,
      nuxt,
      Object.entries(appContentConfig.collections).map(([name, collection]) => ({
        name,
        localized: Boolean(collection.i18n),
        route: typeof collection.route === 'string' ? collection.route : undefined
      }))
    )
    const resolvedI18n = toResolvedContentI18nOptions(localePolicy, options)
    const resolvedSitemap = normalizeSitemapOptions(options)
    const resolvedSearch = normalizeSearchOptions(options)
    await assertPagefindAvailable(resolvedSearch)

    validateCollectionNames(appContentConfig.collections)
    if (!hasAgentSurface(appContentConfig)) {
      options.agent = false
    }
    validateAgentConfig(appContentConfig, options, { dev: nuxt.options.dev })

    const collections = Object.fromEntries(Object.entries(appContentConfig.collections).map(([name, collection]) => [
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
    const provider = appContentConfig.provider || 'filesystem'
    const providerRegistry = { ...(appContentConfig.providers || {}) }
    const contract = buildResolvedContentContract(
      { collections },
      {
        defaultLocale: resolvedI18n.defaultLocale || 'en',
        locales: resolvedI18n.locales.length ? resolvedI18n.locales : [resolvedI18n.defaultLocale || 'en'],
        localeFallbacks: resolvedI18n.fallback,
        translatedSlugs: resolvedI18n.translatedSlugs,
        componentPolicy: options.componentPolicy,
      },
    )
    const contractSha256 = await hashCanonicalJson(contract as unknown as JsonValue)
    // Disable cache in dev mode
    const buildIntegrity = nuxt.options.dev ? undefined : Date.now()

    const contentContext: ContentContext = {
      ...options,
      collections,
      provider,
      providers: providerRegistry,
      transformers: options.transformers || [],
      locales: resolvedI18n.locales,
      defaultLocale: resolvedI18n.defaultLocale,
      localeFallback: resolvedI18n.fallback,
      translatedSlugs: resolvedI18n.translatedSlugs,
      strictTranslatedSlugs: resolvedI18n.strictTranslatedSlugs,
      localePolicy,
      contract,
      contractSha256,
      sitemap: resolvedSitemap,
      search: resolvedSearch,
      validation: options.validation || 'report'
    }
    await rm(resolveFilePath(nuxt.options.buildDir, 'content-cache/validation.json'), { force: true })
    const layers = nuxt.options._layers || [{ cwd: nuxt.options.rootDir, config: {} }]
    const nitroPublicAssets = (nuxt.options as typeof nuxt.options & {
      nitro?: { publicAssets?: Array<{ dir: string, baseURL?: string }> }
    }).nitro?.publicAssets || []
    contentContext.validationPublicAssets = await collectContentValidationPublicAssets({
      rootDir: nuxt.options.rootDir,
      layers: layers.map(layer => ({ cwd: layer.cwd, publicDir: layer.config.dir?.public || 'public' })),
      nitroPublicAssets
    })
    let resolvedContentContext: ResolvedContentContext | undefined
    const getResolvedContentContext = () => {
      if (!resolvedContentContext) {
        throw new Error('Content runtime config was read before content context resolution completed.')
      }
      return resolvedContentContext
    }

    if (resolvedSitemap !== false) {
      if (!hasNuxtSitemapModule(nuxt.options.modules)) {
        logger.warn('content.sitemap is enabled, but the "@nuxtjs/sitemap" module is not registered in nuxt.config modules. No sitemap will be generated until "@nuxtjs/sitemap" is installed and added to modules (see ADR-0009).')
      }
      configureNuxtSitemapSource(nuxt, options.api.baseURL, resolvedSitemap.path)
    }
    nuxt.hook('pages:extend', (pages) => {
      validateContentPageRouteMetadata(pages, collections, {
        locales: resolvedI18n.locales,
        defaultLocale: resolvedI18n.defaultLocale
      })
      const routeFacts = createContentValidationRouteFacts(pages)
      contentContext.validationRouteFacts = routeFacts
      const runtimeContent = (nuxt.options.runtimeConfig.content ||= {}) as Record<string, unknown>
      runtimeContent.validationRouteFacts = routeFacts
      runtimeContent.validationPublicAssets = contentContext.validationPublicAssets
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
          collectionRouteCounts: await readPersistedSitemapCollectionCounts(nuxt.options.buildDir, getResolvedContentContext()),
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
      getSearchRuntime,
      logger
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
  /**
   * Mutable setup registry, called before provider selection is validated.
   * Integrations (e.g. Ginko CMS) use it to register an implementation name.
   */
  'content:providers'(providers: Record<string, string>): void | Promise<void>
  /**
   * Read-only notification called only after the content context is fully
   * resolved. Observers may validate or derive their own
   * artifacts from it; they may not mutate collections, locales, provider
   * selection, or routing policy.
   */
  'content:context'(ctx: Readonly<ResolvedContentContext>): void | Promise<void>
}
