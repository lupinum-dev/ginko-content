import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { globby } from 'globby'
import type { ContentCollectionConfig } from '../types/config'
import type { ParsedContent } from '../types/content'
import type { ResolvedContentContext } from '../types/module'
import { buildContentGraph } from '../core/content/graph'
import { expandDataLocaleVariants } from '../core/content/locale'
import { normalizeCollectionExcludes, normalizeCollectionSources } from '../core/content/sources'
import { resolveCollection } from '../core/content/collection'
import { transformContent } from '../parsers/index.js'
import { prefixPathWithLocale, resolveCollectionI18n } from '../features/localization/path'

type DerivedRouteContext = Pick<
  ResolvedContentContext,
  'collections' | 'locales' | 'defaultLocale' | 'translatedSlugs' | 'respectPathCase' | 'markdown' | 'yaml' | 'csv' | 'sitemap'
>

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

/**
 * Build-time route discovery is derived state: it reparses content files to
 * mirror the canonical ingest pipeline closely enough for Nitro prerender and
 * sitemap assertion decisions. It is rebuildable from content files plus the
 * resolved content context, and contract tests cover the invariants that have
 * historically drifted: localized routes, translated slugs, draft/partial
 * filtering, array sources, and sitemap opt-outs.
 */
const parseDerivedCollectionFiles = async (
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

const collectDerivedDocuments = async (
  rootDir: string,
  contentContext: DerivedRouteContext
) => {
  const collections = contentContext.collections || {}
  const includedCollections = resolveSitemapCollections(collections, contentContext.sitemap)
  if (!includedCollections.length) {
    return { collections, includedCollections, graph: buildContentGraph([], { locales: contentContext.locales, defaultLocale: contentContext.defaultLocale }) }
  }

  const documents = await parseDerivedCollectionFiles(rootDir, collections, includedCollections, contentContext)
  const graph = buildContentGraph(documents, {
    locales: contentContext.locales,
    defaultLocale: contentContext.defaultLocale
  })
  return { collections, includedCollections, graph }
}

export const collectDerivedPrerenderRoutes = async (
  rootDir: string,
  contentContext: DerivedRouteContext
) => {
  if (!contentContext.sitemap) {
    return []
  }

  const { includedCollections, graph } = await collectDerivedDocuments(rootDir, contentContext)
  if (!includedCollections.length) {
    return []
  }

  const routes = new Set<string>()
  for (const collection of includedCollections) {
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
  contentContext: DerivedRouteContext
) => {
  const { includedCollections, graph } = await collectDerivedDocuments(rootDir, contentContext)
  if (!includedCollections.length) {
    return {}
  }

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
