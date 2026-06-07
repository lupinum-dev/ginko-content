import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { globby } from 'globby'
import type { NitroConfig } from 'nitropack'
import type { ContentCollectionConfig } from '../types/config'
import type { ResolvedContentContext } from '../types/module'
import type { ParsedContent } from '../types/content'
import { transformContent } from '../parsers/index.js'
import { expandDataLocaleVariants } from '../core/content/locale'
import { buildContentGraph } from '../core/content/graph'
import { normalizeCollectionExcludes, normalizeCollectionSources } from '../core/content/sources'
import { prefixPathWithLocale, resolveCollectionI18n } from '../features/localization/path'
import { resolveCollection } from '../core/content/collection'
import {
  assertGeneratedSitemaps,
  shouldRunSitemapAssertionOnCompiled
} from './sitemap-assert'

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

const resolveSitemapCollections = (
  collections: Record<string, ContentCollectionConfig>,
  sitemap: ResolvedContentContext['sitemap']
) => {
  if (!sitemap) {
    return []
  }

  const include = sitemap.include?.length ? sitemap.include : Object.keys(collections)
  const excluded = new Set(sitemap.exclude || [])
  return include.filter(collection => !excluded.has(collection) && collections[collection]?.sitemap !== false)
}

const numericSlugSegmentPattern = /^(\d+)\.[^*?[\]{}()]+(.*)$/

const toTranslatedSlugSourcePattern = (source: string) => {
  return source
    .split('/')
    .map((segment) => {
      const match = segment.match(numericSlugSegmentPattern)
      return match ? `${match[1]}.*${match[2] || ''}` : segment
    })
    .join('/')
}

const parseCollectionFiles = async (
  rootDir: string,
  collections: Record<string, ContentCollectionConfig>,
    collectionNames: string[],
  contentContext: Pick<ResolvedContentContext, 'locales' | 'defaultLocale' | 'translatedSlugs' | 'respectPathCase' | 'markdown' | 'yaml' | 'csv'>
) => {
  const contentDir = resolve(rootDir, 'content')
  const patterns = Array.from(new Set(
    collectionNames
      .flatMap((name) => {
        const source = collections[name]?.source
        if (!source) {
          return []
        }

        const sources = normalizeCollectionSources(source)
        const excludes = normalizeCollectionExcludes(collections[name]?.exclude)
        const localeSources = contentContext.translatedSlugs
          ? Array.from(new Set(sources.flatMap(pattern => [
              pattern,
              toTranslatedSlugSourcePattern(pattern)
            ])))
          : sources
        const localePatterns = (contentContext.locales || []).flatMap(locale => localeSources.map(pattern => `${locale}/${pattern}`))
        const excludePatterns = excludes.flatMap(pattern => [
          `!${pattern}`,
          ...(contentContext.locales || []).map(locale => `!${locale}/${pattern}`)
        ])
        return [...sources, ...localePatterns, ...excludePatterns]
      })
      .filter(Boolean)
  ))

  const ids = await globby(patterns, {
    cwd: contentDir,
    onlyFiles: true,
    dot: false
  })

  const documents: ParsedContent[] = []
  for (const id of ids) {
    const file = resolve(contentDir, id)
    const content = await readFile(file, 'utf8')
    // Path-meta derives `_file`, `_path`, and `_collection` from a content-style id, not a bare
    // relative path. Using `content:${id}` keeps this helper aligned with the real ingest pipeline.
    const normalizedId = `content:${relative(contentDir, file).replace(/\\/g, '/')}`
    const parsed = await transformContent(normalizedId, content, {
      markdown: contentContext.markdown,
      yaml: contentContext.yaml,
      csv: contentContext.csv,
      pathMeta: {
        locales: contentContext.locales,
        defaultLocale: contentContext.defaultLocale,
        translatedSlugs: contentContext.translatedSlugs,
        respectPathCase: contentContext.respectPathCase,
        collections,
        collectionResolver: (filePath: string) => resolveCollection(filePath, collections, contentContext.locales || [])
      }
    })
    const collection = typeof parsed._collection === 'string' ? collections[parsed._collection] : undefined
    documents.push(...expandDataLocaleVariants(parsed, collection?.i18n === true ? undefined : collection?.i18n))
  }

  return documents
}

const collectPrerenderRoutes = async (
  rootDir: string,
    contentContext: Pick<ResolvedContentContext, 'collections' | 'locales' | 'defaultLocale' | 'translatedSlugs' | 'respectPathCase' | 'markdown' | 'yaml' | 'csv' | 'sitemap'>
) => {
  const collections = contentContext.collections || {}
  if (!contentContext.sitemap) {
    return []
  }

  const includeCollections = resolveSitemapCollections(collections, contentContext.sitemap)

  if (!includeCollections.length) {
    return []
  }

  const documents = await parseCollectionFiles(rootDir, collections, includeCollections, contentContext)
  const graph = buildContentGraph(documents, {
    locales: contentContext.locales,
    defaultLocale: contentContext.defaultLocale
  })
  const routes = new Set<string>()

  for (const collection of includeCollections) {
    const { defaultLocale } = resolveCollectionI18n(collection, contentContext)
    const includeDrafts = Boolean(contentContext.sitemap.includeDrafts)
    const seenCanonicalKeys = new Set<string>()

    for (const contentId of graph.byCollection[collection] || []) {
      const document = graph.byId[contentId]
      if (!document || !document._canonicalKey || document._partial || document._navigation) {
        continue
      }
      if (document._draft && !includeDrafts) {
        continue
      }
      if (seenCanonicalKeys.has(document._canonicalKey)) {
        continue
      }

      seenCanonicalKeys.add(document._canonicalKey)
      const variants = graph.byCanonical[document._canonicalKey] || {}
      for (const [locale, variant] of Object.entries(variants)) {
        if (!variant.path) {
          continue
        }

        const routeLocale = (contentContext.locales || []).includes(locale) ? locale : undefined
        routes.add(prefixPathWithLocale(variant.path, routeLocale, defaultLocale))
      }
    }
  }

  return Array.from(routes).sort()
}

export const collectSitemapCollectionRouteCounts = async (
  rootDir: string,
    contentContext: Pick<ResolvedContentContext, 'collections' | 'locales' | 'defaultLocale' | 'translatedSlugs' | 'respectPathCase' | 'markdown' | 'yaml' | 'csv' | 'sitemap'>
) => {
  const collections = contentContext.collections || {}
  const includedCollections = resolveSitemapCollections(collections, contentContext.sitemap)

  if (!includedCollections.length) {
    return {}
  }

  const documents = await parseCollectionFiles(rootDir, collections, includedCollections, contentContext)
  const graph = buildContentGraph(documents, {
    locales: contentContext.locales,
    defaultLocale: contentContext.defaultLocale
  })
  const counts = Object.fromEntries(includedCollections.map(collection => [collection, 0])) as Record<string, number>
  const includeDrafts = contentContext.sitemap
    ? Boolean(contentContext.sitemap.includeDrafts)
    : false

  for (const collection of includedCollections) {
    const seenCanonicalKeys = new Set<string>()

    for (const contentId of graph.byCollection[collection] || []) {
      const document = graph.byId[contentId]
      if (!document || !document._canonicalKey || document._partial || document._navigation) {
        continue
      }
      if (document._draft && !includeDrafts) {
        continue
      }
      if (seenCanonicalKeys.has(document._canonicalKey)) {
        continue
      }

      const variants = Object.values(graph.byCanonical[document._canonicalKey] || {})
      if (!variants.some(variant => variant.path)) {
        continue
      }

      seenCanonicalKeys.add(document._canonicalKey)
      counts[collection] += 1
    }
  }

  return counts
}

export const registerContentNitroIntegrationHooks = (
  nitroConfig: NitroConfig,
  options: { rootDir: string, sitemapPrerenderRoutes?: string[] | (() => string[]) },
    contentContext: Pick<ResolvedContentContext, 'collections' | 'locales' | 'defaultLocale' | 'translatedSlugs' | 'respectPathCase' | 'markdown' | 'yaml' | 'csv' | 'sitemap' | 'provider'>
) => {
  const usesFilesystemProvider = !contentContext.provider || contentContext.provider === 'filesystem'

  nitroConfig.hooks ||= {}
  if (contentContext.sitemap && contentContext.sitemap.assert?.enabled) {
    appendHook(nitroConfig.hooks as Record<string, any>, 'compiled', async (nitro: {
      options: { output: { publicDir: string }, static: boolean }
      logger?: { info: (message: string) => void }
    }) => {
      const assertOptions = contentContext.sitemap ? contentContext.sitemap.assert as any : undefined
      if (!assertOptions || !shouldRunSitemapAssertionOnCompiled(assertOptions, nitro)) {
        return
      }

      try {
        await assertGeneratedSitemaps({
          outputPublicDir: nitro.options.output.publicDir,
          options: assertOptions,
          collectionRouteCounts: usesFilesystemProvider
            ? await collectSitemapCollectionRouteCounts(options.rootDir, contentContext)
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
    if (usesFilesystemProvider) {
      for (const route of await collectPrerenderRoutes(options.rootDir, contentContext)) {
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
