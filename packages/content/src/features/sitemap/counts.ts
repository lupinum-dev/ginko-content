/**
 * Sitemap collection route counts, derivable from ANY validated document
 * set — the real Nitro-side build result (`integrations/nitro/build.ts`) or
 * a rebuilt canonical snapshot read back off disk
 * (`module/sitemap-assert.ts`'s generate-mode assertion, which runs too late
 * in the Nuxt CLI process to reach the compiled Nitro app). Framework-free
 * on purpose (no `integrations/nitro/*` imports) so both call sites can use
 * it without pulling in Nitro-runtime-only modules.
 */
import type { ParsedContent } from '../../types/content'
import type { ContentCollectionConfig } from '../../types/config'
import { buildContentGraph, getGraphCanonicalVariants, type ContentGraph } from '../../core/content/graph'
import { resolveIncludeDrafts } from '../../core/visibility'

export interface SitemapCountsContentContext {
  locales?: string[]
  defaultLocale?: string
  collections?: Record<string, ContentCollectionConfig>
  sitemap: false | { include?: string[], exclude?: string[], includeDrafts?: boolean }
}

export const resolveSitemapCollections = (
  collections: Record<string, ContentCollectionConfig>,
  sitemap: SitemapCountsContentContext['sitemap']
): string[] => {
  if (!sitemap) {
    return []
  }
  const include = sitemap.include?.length ? sitemap.include : Object.keys(collections)
  const excluded = new Set(sitemap.exclude || [])
  return include.filter(collection => !excluded.has(collection) && collections[collection]?.sitemap !== false)
}

/**
 * One count per canonical document in `collection` that has at least one
 * concrete path, honoring draft visibility. Mirrors the former
 * `collectSitemapCollectionRouteCounts` (deleted
 * `module/derived-route-discovery.ts`) exactly — only the document SOURCE
 * changed.
 */
export const countSitemapRoutes = (
  graph: ContentGraph,
  collection: string,
  includeDrafts: boolean
): number => {
  let count = 0
  const seenCanonicalKeys = new Set<string>()

  for (const contentId of graph.byCollection[collection] || []) {
    const document = graph.byId[contentId]
    if (!document || !document.canonicalKey || document.partial || document.navigationFile) {
      continue
    }
    if (document.draft && !includeDrafts) {
      continue
    }
    if (seenCanonicalKeys.has(document.canonicalKey)) {
      continue
    }

    const variants = Object.values(getGraphCanonicalVariants(graph, document.canonicalKey, collection) || {})
    if (!variants.some(variant => variant.path)) {
      continue
    }
    seenCanonicalKeys.add(document.canonicalKey)
    count += 1
  }

  return count
}

export const computeSitemapCollectionCounts = (
  documents: ParsedContent[],
  contentContext: SitemapCountsContentContext
): Record<string, number> => {
  const collections = contentContext.collections || {}
  const graph = buildContentGraph(documents, {
    locales: contentContext.locales,
    defaultLocale: contentContext.defaultLocale
  })
  const sitemapCollections = resolveSitemapCollections(collections, contentContext.sitemap)
  const includeDrafts = resolveIncludeDrafts({
    environment: 'production',
    includeDrafts: contentContext.sitemap ? contentContext.sitemap.includeDrafts : undefined
  })

  const counts: Record<string, number> = {}
  for (const name of sitemapCollections) {
    counts[name] = countSitemapRoutes(graph, name, includeDrafts)
  }
  return counts
}
