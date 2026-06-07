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
import type { ContentContext, ContentRevalidateOptions, ModuleOptions, ResolvedContentContext } from './types/module'
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
import { validateContentPageRouteMetadata } from './module/route-meta-validation'
import { collectTopLevelReferenceFieldsByTarget } from './core/references/schema'
import { normalizeAgentRouteOptions } from './module/agent-options'
import { hasAgentSurface, validateAgentConfig } from './module/agent-config'

const hookNuxtBoundary = <T>(
  nuxt: { hook: unknown },
  name: string,
  callback: (payload: T) => void | Promise<void>
) => {
  const hook = nuxt.hook as (hookName: string, callback: (payload: T) => void | Promise<void>) => void
  hook(name, callback)
}

const normalizeRoutePath = (path: string) => {
  if (!path || path === '/') return '/'
  return `/${path.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '')}`
}

const collectMarkdownLinksFromLlms = (markdown: string, siteUrl: string | undefined) => {
  const links = new Set<string>()
  const pattern = /\[[^\]]*\]\(([^)]+)\)/g
  for (const match of markdown.matchAll(pattern)) {
    const href = match[1]
    if (!href) continue
    try {
      const url = /^[a-z][a-z0-9+.-]*:/i.test(href)
        ? new URL(href)
        : new URL(href, siteUrl || 'http://localhost:3000')
      if (url.pathname.startsWith('/raw/') && url.pathname.endsWith('.md')) links.add(url.pathname)
    } catch {
      if (href.startsWith('/raw/') && href.endsWith('.md')) links.add(href)
    }
  }
  return Array.from(links)
}

const collectMarkdownRoutesFromGeneratedFrontmatter = (markdown: string) => {
  const links = new Set<string>()
  const addRoutePath = (route: string) => {
    const normalized = normalizeRoutePath(route)
    links.add(normalized === '/' ? '/raw/index.md' : `/raw${normalized}.md`)
  }
  const addFrontmatterRoute = (frontmatter: string | undefined) => {
    const route = /^route:\s*"([^"]+)"/m.exec(frontmatter || '')?.[1]
    if (!route) return
    addRoutePath(route)
  }
  const addSourceRoute = (source: string | undefined) => {
    if (!source) return
    try {
      addRoutePath(new URL(source, 'http://localhost:3000').pathname)
    } catch {
      addRoutePath(source)
    }
  }

  // llms-full.txt is a concatenated Markdown document. Each page is emitted as:
  //   ---
  //   Source: ...
  //
  //   ---
  //   title: ...
  //   route: ...
  //   ---
  // Parse only those generated page-frontmatter blocks so static builds mirror
  // the page index without returning to broad Markdown-link scraping.
  const sourcePattern = /^Source:\s+(\S+)/gm
  for (const match of markdown.matchAll(sourcePattern)) {
    addSourceRoute(match[1])
  }

  const pageFrontmatterPattern = /^Source:\s+[^\n]+\n\n---\n([\s\S]*?)\n---/gm
  for (const match of markdown.matchAll(pageFrontmatterPattern)) {
    addFrontmatterRoute(match[1])
  }

  const firstFrontmatter = /^---\n([\s\S]*?)\n---/.exec(markdown)?.[1]
  addFrontmatterRoute(firstFrontmatter)

  return Array.from(links)
}

const publicOutputPath = (publicDir: string, route: string) =>
  join(publicDir, normalizeRoutePath(route).replace(/^\//, ''))

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
    watch: true,
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
    agent: {
      routes: true,
      linkHeaders: true,
      markdownNegotiation: true,
      prerender: true
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

      // Tell Nuxt to ignore content dir for app build
      for (const source of Object.values(sources)) {
        // Only targets directories inside the srcDir
        if (source.driver === 'fs' && typeof source.base === 'string' && source.base.includes(nuxt.options.srcDir)) {
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
      if (contentContext.cache) {
        nitroConfig.plugins ||= []
        const cachePlugin = resolveRuntimeModule('server/plugins/cache.js')
        if (!nitroConfig.plugins.includes(cachePlugin)) {
          nitroConfig.plugins.push(cachePlugin)
        }
      }

      const resolvedRuntimeContext = getResolvedContentContext()
      registerContentNitroIntegrationHooks(nitroConfig, {
        rootDir: nuxt.options.rootDir,
        sitemapPrerenderRoutes: () => contentContext.sitemap === false ? [] : resolveNuxtSitemapPrerenderRoutes(nuxt)
      }, {
        collections: resolvedRuntimeContext.collections,
        locales: resolvedRuntimeContext.locales,
        defaultLocale: resolvedRuntimeContext.defaultLocale,
        translatedSlugs: resolvedRuntimeContext.translatedSlugs,
        respectPathCase: resolvedRuntimeContext.respectPathCase,
        markdown: resolvedRuntimeContext.markdown,
        yaml: resolvedRuntimeContext.yaml,
        csv: resolvedRuntimeContext.csv,
        sitemap: resolvedRuntimeContext.sitemap,
        provider: resolvedRuntimeContext.provider
      })

      const agentRoutes = normalizeAgentRouteOptions(options)
      if (agentRoutes.routes && agentRoutes.prerender && appContentConfig.agent) {
        nitroConfig.prerender.routes.push('/llms.txt', '/llms-full.txt')
        for (const locale of appContentConfig.agent.site?.locales || resolvedI18n.locales || []) {
          if (locale && locale !== (appContentConfig.agent.site?.defaultLocale || resolvedI18n.defaultLocale)) {
            nitroConfig.prerender.routes.push(`/${locale}/llms.txt`, `/${locale}/llms-full.txt`)
          }
        }
        for (const page of appContentConfig.agent.pages || []) {
          const routes = typeof page.route === 'string'
            ? [page.route]
            : Object.values(page.route)
          for (const route of routes) {
            const normalized = route === '/' ? '/' : `/${route.replace(/^\/+|\/+$/g, '')}`
            nitroConfig.prerender.routes.push(
              normalized === '/' ? '/raw/index.md' : `/raw${normalized}.md`,
              normalized === '/' ? '/index.md' : `${normalized}/index.md`
            )
          }
        }
      }
    })
    if (!nuxt.options.dev) {
      hookNuxtBoundary(nuxt, 'nitro:build:before', (nitro: {
        hooks: { hook: (name: string, callback: (payload: any) => void | Promise<void>) => void }
        options: { output: { publicDir?: string } }
      }) => {
        nitro.hooks.hook('prerender:init', (prerenderer: any) => {
          prerenderer.hooks.hook('compiled', async () => {
            const searchRuntime = getSearchRuntime()
            const publicDir = nitro.options.output.publicDir
              || (nuxt.options as { nitro?: { output?: { publicDir?: string } } }).nitro?.output?.publicDir
              || resolveFilePath(nuxt.options.rootDir, '.output/public')
            const serverFilename = typeof prerenderer.options.rollupConfig?.output?.entryFileNames === 'string'
              ? prerenderer.options.rollupConfig.output.entryFileNames
              : 'index.mjs'
            const serverEntrypoint = resolveFilePath(prerenderer.options.output.serverDir, serverFilename)
            const { localFetch } = await import(pathToFileURL(serverEntrypoint).href)

            if (
              searchRuntime !== false
              && searchRuntime.engine !== 'cms'
              && (!contentContext.provider || contentContext.provider === 'filesystem')
            ) {
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
            }

            const agentRoutes = normalizeAgentRouteOptions(options)
            if (agentRoutes.routes && agentRoutes.prerender && appContentConfig.agent) {
              const defaultLocale = appContentConfig.agent.site?.defaultLocale || resolvedI18n.defaultLocale
              const locales = appContentConfig.agent.site?.locales?.length
                ? appContentConfig.agent.site.locales
                : resolvedI18n.locales
              const llmsRoutes = [
                '/llms.txt',
                '/llms-full.txt',
                ...locales
                  .filter(locale => locale && locale !== defaultLocale)
                  .flatMap(locale => [`/${locale}/llms.txt`, `/${locale}/llms-full.txt`])
              ]
              const markdownRoutes = new Set<string>()

              for (const route of llmsRoutes) {
                const response = await localFetch(route)
                if (!response.ok) {
                  throw new Error(`Failed to generate agent markdown route ${route}: [${response.status}] ${response.statusText}`)
                }
                const body = await response.text()
                const outputPath = publicOutputPath(publicDir, route)
                mkdirSync(dirname(outputPath), { recursive: true })
                writeFileSync(outputPath, body, 'utf8')
                if (/\/llms\.txt$/i.test(route)) {
                  collectMarkdownLinksFromLlms(body, appContentConfig.agent.site?.url).forEach(link => markdownRoutes.add(link))
                } else if (/\/llms-full\.txt$/i.test(route)) {
                  collectMarkdownRoutesFromGeneratedFrontmatter(body).forEach(link => markdownRoutes.add(link))
                }
              }

              for (const route of markdownRoutes) {
                const response = await localFetch(route)
                if (!response.ok) {
                  throw new Error(`Failed to generate agent markdown route ${route}: [${response.status}] ${response.statusText}`)
                }
                const body = await response.text()
                const outputPath = publicOutputPath(publicDir, route)
                mkdirSync(dirname(outputPath), { recursive: true })
                writeFileSync(outputPath, body, 'utf8')

                if (route.startsWith('/raw/') && route.endsWith('.md')) {
                  const pageRoute = route.replace(/^\/raw/, '').replace(/\.md$/, '')
                  const indexRoute = pageRoute === '/index' ? '/index.md' : `${pageRoute}/index.md`
                  const indexPath = publicOutputPath(publicDir, indexRoute)
                  mkdirSync(dirname(indexPath), { recursive: true })
                  writeFileSync(indexPath, body, 'utf8')
                }
              }
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
      resolvedContentContext = {
        ...contentContext,
        markdown: processMarkdownOptions(contentContext.markdown)
      }
      await validateBuiltinMarkdownPlugins(resolvedContentContext.markdown.plugins, resolvePath)

      const runtimeCollections = Object.fromEntries(Object.entries(options.collections || {}).map(([name, collection]) => {
        const references = collectTopLevelReferenceFieldsByTarget(collection.schema)
        return [
          name,
          {
            ...(collection.source ? { source: collection.source } : {}),
            ...(collection.exclude ? { exclude: collection.exclude } : {}),
            ...(collection.type ? { type: collection.type } : {}),
            strict: collection.strict ?? true,
            ...(collection.route ? { route: collection.route } : {}),
            ...(typeof collection.sitemap === 'boolean' ? { sitemap: collection.sitemap } : {}),
            ...(collection.i18n && collection.i18n !== true ? { i18n: collection.i18n } : {}),
            ...(Object.keys(references).length ? { references } : {})
          }
        ]
      }))
      const cacheIntegrity = hash({
        locales: resolvedContentContext.locales,
        defaultLocale: resolvedContentContext.defaultLocale,
        localeFallback: resolvedContentContext.localeFallback,
        translatedSlugs: resolvedContentContext.translatedSlugs,
        strictTranslatedSlugs: resolvedContentContext.strictTranslatedSlugs,
        respectPathCase: resolvedContentContext.respectPathCase,
        collections: runtimeCollections,
        markdown: resolvedContentContext.markdown,
        yaml: resolvedContentContext.yaml,
        csv: resolvedContentContext.csv
      })

      applyContentRuntimeConfig(nuxt, options, resolvedContentContext, runtimeCollections, buildIntegrity, cacheIntegrity)
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

  navigation: ModuleOptions['navigation']

  search: ReturnType<typeof createSearchRuntimeConfig> | false

  contentHead: ModuleOptions['contentHead']
}

function validateCollectionNames (collections: Record<string, ContentCollectionConfig>) {
  normalizeContentConfigCollectionNames(collections)
}

function validateRemovedMarkdownOptions (options: ModuleOptions) {
  if ((options as unknown as Record<string, unknown>).highlight !== undefined) {
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
    } catch (error: unknown) {
      const next = new Error(`Markdown plugin "${plugin.name}" requires "${peerDependency}" to be installed.`)
      ;(next as Error & { cause?: unknown }).cause = error
      throw next
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
