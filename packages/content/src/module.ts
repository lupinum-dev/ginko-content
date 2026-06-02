import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve as resolveFilePath } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createResolver,
  defineNuxtModule,
  addTemplate,
  useLogger
} from '@nuxt/kit'
import { defu } from 'defu'
import { hash } from 'ohash'
import { join } from 'pathe'
import { withTrailingSlash } from 'ufo'
import { name, version } from '../package.json'
import type { ParsedContent, ResolvedMarkdownPlugin, MarkdownOptions } from './types/content'
import type { ContentCollectionConfig, ContentCollectionI18nConfig } from './types/config'
import { normalizeContentConfigCollectionNames } from './types/config'
import type { StorageValue } from 'unstorage'
import {
  processMarkdownOptions,
  useContentMounts
} from './utils'
import type { ContentContext, ContentRevalidateOptions, ModuleOptions } from './types/module'
import { loadContentConfig, resolveContentConfigPath } from './utils/content-config'
import { createVirtualContentTemplates, registerVirtualContentAliases } from './module/virtual'
import { registerContentDevRuntime } from './module/dev'
import { registerContentI18nTemplate, registerGeneratedTypes, registerRuntimeComponents, registerRuntimeImports, registerUserContentComponents, registerDevRuntimePlugin } from './module/runtime-assets'
import { registerContentSearchServerHandlers, registerContentServerHandlers } from './module/server-handlers'
import { applyContentRuntimeConfig } from './module/runtime-config'
import { registerContentComponentsTemplate } from './module/content-components-template'
import { resolveCollectionI18nConfig } from './features/localization/config'
import { collectSitemapCollectionRouteCounts, registerContentNitroIntegrationHooks } from './module/integration-hooks'
import {
  createSitemapAssertionTargetsFromPrerenderedSitemaps,
  shouldRunSitemapAssertionOnPrerenderedSitemaps,
  assertGeneratedSitemaps
} from './module/sitemap-assert'
import { configureNuxtSitemapSource, createSearchRuntimeConfig, hasNuxtI18nModule, normalizeSearchOptions, normalizeSitemapOptions, resolveModuleI18nOptions, resolveNuxtSitemapPrerenderRoutes } from './module/options'

export { defineCollection, defineContentConfig, reference } from './types/config.js'
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
  defaults: {
    api: {
      baseURL: '/api/_content'
    },
    i18n: true,
    sitemap: true,
    search: {
      engine: 'minisearch',
      ignoredTags: ['script', 'style', 'pre'],
      filterQuery: { _draft: false, _partial: false },
      extraFields: [],
      minisearch: {
        fields: ['title', 'content', 'headings'],
        storeFields: ['path', 'title', 'excerpt', 'anchor', 'locale'],
        boost: {
          title: 4,
          headings: 2,
          content: 1
        },
        fuzzy: 0.2,
        prefix: true
      }
    },
    watch: {
      ws: {
        port: {
          port: 4000,
          portRange: [4000, 4040]
        },
        hostname: 'localhost',
        showURL: false
      }
    },
    sources: {},
    ignores: [],
    collections: {},
    markdown: {
      plugins: [],
      tags: {
        code: 'ProseCode',
        img: 'ProseImg',
        pre: 'ProsePre'
      },
      anchorLinks: {
        depth: 4,
        exclude: [1]
      },
      image: 'auto'
    },
    yaml: {},
    csv: {
      delimiter: ',',
      json: true
    },
    navigation: {
      fields: []
    },
    contentHead: true,
    respectPathCase: false,
    experimental: {
      stripQueryParameters: false
    }
  },
  async setup (options, nuxt) {
    const { resolve, resolvePath } = createResolver(import.meta.url)
    const logger = useLogger(name)
    const resolveRuntimeModule = (path: string) => resolve('./runtime', path)
    const runtimeInlineDependencies = ['comark', '@comark/vue']
    validateRemovedMarkdownOptions(options)
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
    const resolvedI18n = resolveModuleI18nOptions(options, nuxt)
    const resolvedSitemap = normalizeSitemapOptions(options)
    const resolvedSearch = normalizeSearchOptions(options)

    validateCollectionNames(appContentConfig.collections)

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
    if (resolvedSitemap !== false) {
      configureNuxtSitemapSource(nuxt, options.api.baseURL, resolvedSitemap.path)
    }
    if (resolvedSitemap && resolvedSitemap.assert.enabled) {
      // Validate the final XML files through Nuxt Sitemap's own hook. Nitro's lower-level build
      // hooks can run before locale child sitemaps exist, which is what caused the earlier false
      // positives and the temptation to paper over things with app-owned prerender route lists.
      nuxt.hook('sitemap:prerender:done' as any, async ({ sitemaps }: {
        sitemaps: Array<{ name: string, content: string }>
      }) => {
        const assertOptions = contentContext.sitemap?.assert
        if (!assertOptions || !shouldRunSitemapAssertionOnPrerenderedSitemaps(assertOptions)) {
          return
        }

        await assertGeneratedSitemaps({
          options: assertOptions,
          targets: createSitemapAssertionTargetsFromPrerenderedSitemaps(sitemaps),
          collectionRouteCounts: await collectSitemapCollectionRouteCounts(nuxt.options.rootDir, contentContext),
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
    nuxt.hook('nitro:config', (nitroConfig) => {
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

      // Tell Nuxt to ignore content dir for app build
      for (const source of Object.values(sources)) {
        // Only targets directories inside the srcDir
        if (source.driver === 'fs' && source.base.includes(nuxt.options.srcDir)) {
          const wildcard = join(source.base, '**/*').replace(withTrailingSlash(nuxt.options.srcDir), '')
          nuxt.options.ignore.push(
            // Remove `srcDir` from the path
            wildcard,
            `!${wildcard}.vue`
          )
        }
      }
      nitroConfig.bundledStorage = nitroConfig.bundledStorage || []
      nitroConfig.bundledStorage.push('cache:content')

      nitroConfig.externals = defu(typeof nitroConfig.externals === 'object' ? nitroConfig.externals : {}, {
        inline: [
          resolve('./runtime'),
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
      if (contentContext.cache && contentContext.cache !== false) {
        nitroConfig.plugins ||= []
        const cachePlugin = resolveRuntimeModule('server/plugins/cache.js')
        if (!nitroConfig.plugins.includes(cachePlugin)) {
          nitroConfig.plugins.push(cachePlugin)
        }
      }

      registerContentNitroIntegrationHooks(nitroConfig, {
        rootDir: nuxt.options.rootDir,
        sitemapPrerenderRoutes: contentContext.sitemap === false ? [] : resolveNuxtSitemapPrerenderRoutes(nuxt)
      }, {
        collections: contentContext.collections,
        locales: contentContext.locales,
        defaultLocale: contentContext.defaultLocale,
        translatedSlugs: contentContext.translatedSlugs,
        strictTranslatedSlugs: contentContext.strictTranslatedSlugs,
        respectPathCase: contentContext.respectPathCase,
        markdown: contentContext.markdown,
        yaml: contentContext.yaml,
        csv: contentContext.csv,
        sitemap: contentContext.sitemap,
        provider: contentContext.provider
      })
    })
    if (!nuxt.options.dev) {
      nuxt.hook('nitro:build:before', (nitro) => {
        nitro.hooks.hook('prerender:init', (prerenderer) => {
          prerenderer.hooks.hook('compiled', async () => {
            const searchRuntime = getSearchRuntime()
            if (
              searchRuntime === false
              || searchRuntime.engine === 'cms'
              || (contentContext.provider && contentContext.provider !== 'filesystem')
            ) {
              return
            }

            const publicDir = nitro.options.output.publicDir
              || nuxt.options.nitro.output?.publicDir
              || resolveFilePath(nuxt.options.rootDir, '.output/public')
            const serverFilename = typeof prerenderer.options.rollupConfig?.output?.entryFileNames === 'string'
              ? prerenderer.options.rollupConfig.output.entryFileNames
              : 'index.mjs'
            const serverEntrypoint = resolveFilePath(prerenderer.options.output.serverDir, serverFilename)
            const { localFetch } = await import(pathToFileURL(serverEntrypoint).href)
            const response = await localFetch(searchRuntime.indexURL)

            if (!response.ok) {
              throw new Error(`Failed to generate search index: [${response.status}] ${response.statusText}`)
            }

            const json = await response.text()
            const indexPath = join(publicDir, searchRuntime.indexURL.replace(/^\//, ''))
            mkdirSync(dirname(indexPath), { recursive: true })
            writeFileSync(indexPath, json, 'utf8')

            if (searchRuntime.engine === 'pagefind') {
              const records = JSON.parse(json)
              const { writePagefindIndex } = await import(resolveRuntimeModule('./server/pagefind.js'))
              await writePagefindIndex(records, resolveFilePath(publicDir, 'pagefind'))
            }
          })
        })
      })
    }
    nuxt.hook('modules:done', async () => {
      await nuxt.callHook('content:providers', contentContext.providers ||= {})
      assertConfiguredProviderAvailable(contentContext)
      await nuxt.callHook('content:context', contentContext)

      if (contentContext.search !== false) {
        registerContentSearchServerHandlers(options.api.baseURL, contentContext.search, resolveRuntimeModule)
      }

      contentContext.defaultLocale = contentContext.defaultLocale || contentContext.locales[0]
      contentContext.markdown = processMarkdownOptions(contentContext.markdown)
      await validateBuiltinMarkdownPlugins(contentContext.markdown.plugins, resolvePath)

      const runtimeCollections = Object.fromEntries(Object.entries(options.collections || {}).map(([name, collection]) => [
        name,
        {
          ...(collection.source ? { source: collection.source } : {}),
          ...(collection.exclude ? { exclude: collection.exclude } : {}),
          ...(collection.type ? { type: collection.type } : {}),
          strict: collection.strict ?? true,
          ...(collection.route ? { route: collection.route } : {}),
          ...(typeof collection.sitemap === 'boolean' ? { sitemap: collection.sitemap } : {}),
          ...(collection.i18n && collection.i18n !== true ? { i18n: collection.i18n } : {})
        }
      ]))
      const cacheIntegrity = hash({
        locales: contentContext.locales,
        defaultLocale: contentContext.defaultLocale,
        localeFallback: contentContext.localeFallback,
        translatedSlugs: contentContext.translatedSlugs,
        strictTranslatedSlugs: contentContext.strictTranslatedSlugs,
        respectPathCase: contentContext.respectPathCase,
        collections: runtimeCollections,
        markdown: contentContext.markdown,
        yaml: contentContext.yaml,
        csv: contentContext.csv
      })

      applyContentRuntimeConfig(nuxt, options, contentContext, runtimeCollections, buildIntegrity, cacheIntegrity)
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

function assertConfiguredProviderAvailable(contentContext: Pick<ContentContext, 'provider' | 'providers'>) {
  const provider = contentContext.provider || 'filesystem'
  if (provider === 'filesystem') return

  if (contentContext.providers?.[provider]) return

  if (provider === 'cms') {
    throw new Error('content.config.ts sets provider "cms", but no CMS provider module registered it. Add @lupinum/ginko-cms to nuxt.config.ts modules or remove provider: "cms".')
  }

  throw new Error(`content.config.ts sets provider "${provider}", but no provider module registered it. Register a module for "${provider}" or add it to content providers.`)
}

interface ModulePublicRuntimeConfig {
  experimental: {
    stripQueryParameters: boolean
  }

  api: {
    baseURL: string
  }

  sitemap: {
    path: string
    include?: string[]
    exclude?: string[]
    includeDrafts?: boolean
  } | false

  integrity: number | undefined

  respectPathCase: boolean

  defaultLocale: ContentContext['defaultLocale']

  locales: ContentContext['locales']

  provider: ContentContext['provider']

  providers: ContentContext['providers']

  collections: Record<string, {
    source: ContentCollectionConfig['source']
    exclude?: ContentCollectionConfig['exclude']
    strict: boolean
    i18n?: ContentCollectionI18nConfig
    sitemap?: boolean
  }>

  localeFallback: ContentContext['localeFallback']

  translatedSlugs: ContentContext['translatedSlugs']

  strictTranslatedSlugs: ContentContext['strictTranslatedSlugs']

  markdown: MarkdownOptions

  // Websocket server URL
  wsUrl?: string;

  navigation: ModuleOptions['navigation']

  search: ReturnType<typeof createSearchRuntimeConfig> | false

  contentHead: ModuleOptions['contentHead']
}

function validateCollectionNames (collections: Record<string, ContentCollectionConfig>) {
  normalizeContentConfigCollectionNames(collections)
}

function validateRemovedMarkdownOptions (options: ModuleOptions) {
  if ((options as Record<string, unknown>).highlight !== undefined) {
    throw new Error('`content.highlight` was removed. Enable syntax highlighting with `content.markdown.plugins`, for example `[[\'highlight\', { ...options }]]`.')
  }

  const markdown = (options.markdown || {}) as Record<string, unknown>
  const removedOptions = ['mdc', 'remarkPlugins', 'rehypePlugins', 'toc']
  const removed = removedOptions.filter(key => typeof markdown[key] !== 'undefined')

  if (removed.length) {
    throw new Error(`Removed markdown options: ${removed.map(option => `content.markdown.${String(option)}`).join(', ')}. Use ordered \`content.markdown.plugins\` entries instead.`)
  }
}

async function validateBuiltinMarkdownPlugins (
  plugins: ResolvedMarkdownPlugin[],
  resolvePath: (path: string) => Promise<string>
) {
  for (const plugin of plugins) {
    const peerDependency = BUILTIN_PLUGIN_PEER_DEPS[plugin.name]
    if (!peerDependency) {
      continue
    }

    try {
      await resolvePath(peerDependency)
    } catch (error: any) {
      throw new Error(`Markdown plugin "${plugin.name}" requires "${peerDependency}" to be installed.`, { cause: error })
    }
  }
}

const BUILTIN_PLUGIN_PEER_DEPS: Record<string, string | undefined> = {
  highlight: 'shiki',
  math: 'katex',
  mermaid: 'beautiful-mermaid'
}

interface ModulePrivateRuntimeConfig {
  /**
   * Internal version that represents cache format.
   * This is used to invalidate cache when the format changes.
   */
  cacheVersion: string;
  cacheIntegrity: string;
  revalidate?: false | ContentRevalidateOptions;
}

declare module '@nuxt/schema' {
  interface NuxtHooks {
    'content:context': (ctx: ContentContext) => void | Promise<void>
  }
  interface PublicRuntimeConfig {
    content: ModulePublicRuntimeConfig;
  }
  interface PrivateRuntimeConfig {
    content: ModulePrivateRuntimeConfig & ContentContext;
  }
}

// Keep sync with src/runtime/server/storage.ts
declare module 'nitropack' {
  interface NitroRuntimeHooks {
    'content:file:beforeParse': (file: { _id: string; body: StorageValue }) => void;
    'content:file:afterParse': (file: ParsedContent) => void;
  }
}
