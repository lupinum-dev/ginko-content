/**
 * The canonical Nitro-side content build.
 *
 * `buildContentResult(event)` is the ONE producer of `ContentBuildResult`: it
 * runs the real ingest pipeline (mounted storage, the virtual transformer
 * module, `content:file:beforeParse`/`afterParse` hooks — see
 * `integrations/nitro/ingest.ts#parseContentVariants`) inside the real
 * compiled Nitro app, then validates documents, the JSON-purity gate, the
 * graph, locale policy, routes, alternates, and counts — all
 * BEFORE anything is persisted. It never touches disk itself; the caller
 * (`runtime/server/api/cache.ts`) performs the one durable `snapshot.json`
 * write only after this function returns successfully, and Nitro build hooks
 * (`module/integration-hooks.ts`) consume `.routes` and `.counts` from this
 * result instead of parsing content again.
 */
import type { H3Event } from 'h3'
import type { ParsedContent } from '../../types/content'
import type { ContentCollectionConfig } from '../../types/config'
import type { ResolvedContentContext } from '../../types/module'
import type { ContentGraph } from '../../core/content/graph'
import { buildContentGraph, getGraphCanonicalVariants } from '../../core/content/graph'
import { isRealDocument } from '../../core/content/document'
import { buildContentSnapshot, assertSnapshotComplete, isContentSnapshot, type ContentSnapshot } from '../../core/content/snapshot'
import { validateContentGraph } from '../../storage/validation'
import { usesProcessSnapshot } from '../../storage/snapshot-runtime'
import { resolveIncludeDrafts } from '../../core/visibility'
import { isNavigationFile } from '../../core/content/structural'
import { resolveCollectionI18n } from '../../features/localization/path'
import type { ResolvedCollectionLocalePolicy } from '../../features/localization/locale-policy'
import {
  buildRouteRecords,
  resolveContentRoute,
  synthesizeAlternates,
  type ContentProviderRouteFact,
  type ProjectedContentRouteRecord
} from '../../features/localization/route-projector'
import { countSitemapRoutes, resolveSitemapCollections } from '../../features/sitemap/counts'
import { extractSitemapMetadata } from '../../features/sitemap/metadata'
import { chunksFromArray, loadContentVariants } from '../../storage/contents'
import { cacheStorage, contentConfig, getSourceContentIds, sourceStorage } from './storage'
import { validateContentLinks } from '../../features/validation/links'
import { CONTENT_VALIDATION_REPORT_VERSION, isContentValidationReport, type ContentValidationReport } from '../../features/validation/report'
import { dirname, normalize, join } from 'pathe'

export { computeSitemapCollectionCounts } from '../../features/sitemap/counts'

export interface ContentBuildResult {
  snapshot: ContentSnapshot
  routes: readonly ProjectedContentRouteRecord[]
  validation: ContentValidationReport
  counts: {
    documents: number
    routesByCollection: Readonly<Record<string, number>>
    sitemapByCollection: Readonly<Record<string, number>>
  }
}

/**
 * A source id that produced no snapshot document is always a hard failure:
 * every mounted source must parse into at least one real document. A valid
 * `type: 'data'` document need not have a route and still belongs in the
 * snapshot and graph.
 */
const describeUnreadableSource = () => 'unreadable (source missing or failed to parse)'

const isDataCollection = (collections: Record<string, ContentCollectionConfig>, name: string) =>
  collections[name]?.type === 'data'

const resolveRouteCollections = (collections: Record<string, ContentCollectionConfig>): string[] =>
  Object.keys(collections).filter(name => !isDataCollection(collections, name))

/**
 * One immutable, locale-prefix-only policy per collection. No collection
 * route mount is threaded through here, so this stays a pure
 * `{ locale }` to content-path projection from the canonical graph.
 */
const routePolicyFor = (
  collection: string,
  contentContext: Pick<ResolvedContentContext, 'locales' | 'defaultLocale' | 'collections'>
): ResolvedCollectionLocalePolicy => {
  const { defaultLocale } = resolveCollectionI18n(collection, contentContext)
  return {
    localized: true,
    locales: contentContext.locales || [],
    defaultLocale,
    fallback: {},
    translatedSlugs: false,
    routeMounts: {}
  }
}

/**
 * One route fact per `{collection, canonicalKey, locale}` concrete variant,
 * deduped by canonical key (each canonical document is only visited once
 * even though it appears under every one of its locale variants' content
 * ids in `graph.byCollection`).
 */
const collectRouteFacts = (graph: ContentGraph, collection: string): ContentProviderRouteFact[] => {
  const facts: ContentProviderRouteFact[] = []
  const seenCanonicalKeys = new Set<string>()

  for (const contentId of graph.byCollection[collection] || []) {
    const document = graph.byId[contentId]
    if (!document || !document.canonicalKey || document.partial || isNavigationFile(document)) {
      continue
    }
    if (seenCanonicalKeys.has(document.canonicalKey)) {
      continue
    }
    seenCanonicalKeys.add(document.canonicalKey)

    const variants = getGraphCanonicalVariants(graph, document.canonicalKey, collection) || {}
    for (const [locale, variant] of Object.entries(variants)) {
      if (!variant.path) {
        continue
      }
      const sitemapMetadata = extractSitemapMetadata(variant.document || {})
      facts.push({
        collection,
        canonicalKey: document.canonicalKey,
        locale,
        contentPath: variant.path,
        draft: Boolean(variant.document?.draft),
        sitemap: sitemapMetadata !== false,
        ...(sitemapMetadata && typeof sitemapMetadata === 'object' ? { sitemapMetadata } : {})
      })
    }
  }

  return facts
}

const createValidationReport = async (
  event: H3Event,
  documents: ParsedContent[],
  routes: readonly ProjectedContentRouteRecord[],
  graph: ContentGraph,
  contentContext: ResolvedContentContext & { cacheIntegrity: string },
  generatedAt: number
): Promise<ContentValidationReport> => {
  const publicAssets = new Set(contentContext.validationPublicAssets || [])
  const findings = await validateContentLinks(documents, {
    routes,
    graph,
    defaultLocale: contentContext.defaultLocale,
    links: contentContext.links,
    routeFacts: contentContext.validationRouteFacts,
    assetExists: async (document, authoredPath) => {
      if (authoredPath.startsWith('/')) return publicAssets.has(authoredPath)
      const source = document.file?.source
      const sourceFile = document.file?.path
      if (!source || !sourceFile) return false
      const relativePath = normalize(join(dirname(sourceFile), authoredPath))
      if (relativePath === '..' || relativePath.startsWith('../')) return false
      return await sourceStorage(event).hasItem(`${source}:${relativePath}`)
    }
  })
  return {
    version: CONTENT_VALIDATION_REPORT_VERSION,
    generatedAt,
    integrity: contentContext.cacheIntegrity,
    findings
  }
}

/**
 * Validate that every alternate synthesized for a canonical document
 * round-trips back through the route index to the SAME canonical key
 *. A mismatch means the projector/resolver pair is
 * not a true inverse for this collection's policy — a build-breaking defect,
 * not a per-request condition to degrade gracefully.
 */
const assertAlternateRoundTrips = (
  collection: string,
  facts: ContentProviderRouteFact[],
  policy: ResolvedCollectionLocalePolicy,
  index: ReturnType<typeof buildRouteRecords>['index']
) => {
  const canonicalKeys = new Set(facts.map(fact => fact.canonicalKey))
  for (const canonicalKey of canonicalKeys) {
    const alternates = synthesizeAlternates(canonicalKey, facts, policy, index)
    for (const alternate of alternates) {
      const resolved = resolveContentRoute(alternate.path, alternate.locale, policy, index)
      if (!resolved || resolved.canonicalKey !== canonicalKey) {
        throw new Error(
          `[content] build failed: alternate round-trip mismatch for collection "${collection}", `
          + `canonical key "${canonicalKey}", locale "${alternate.locale}" (path "${alternate.path}").`
        )
      }
    }
  }
}

/**
 * Build the canonical `ContentBuildResult` in memory. Throws (never returns
 * a partial result) on any ingest, schema, JSON-purity, completeness, graph,
 * route, or alternate-round-trip failure — the caller must not persist
 * anything when this throws.
 */
export const buildContentResult = async (event: H3Event): Promise<ContentBuildResult> => {
  const now = Date.now()
  const contentContext = contentConfig()
  const collections = contentContext.collections || {}

  // A genuinely compiled, request-servable production main instance never
  // has the raw `content:source` mount available at all -- that mount is
  // registered as Nitro `devStorage` (`module/nitro-config.ts`), which is a
  // build/dev-time-only concept and is never part of the final `storage`
  // config a real deployed node-server ships with (by design: production
  // reads are meant to come from the durable, already-published snapshot via
  // `getProcessDocuments`/`usesProcessSnapshot`). This
  // route is unshifted into the prerender crawl queue purely to seed that
  // crawl (`module/nitro-config.ts`), and its 'compiled'-hook-driven,
  // post-build JSON fetch (`module/integration-hooks.ts#fetchSitemapCollectionCounts`)
  // spawns exactly that final compiled instance -- so a live re-parse here
  // would always find zero mounted sources there (confirmed empirically
  // against a real `nuxi build`). Reuse the already-published, already-
  // validated snapshot instead of re-deriving it in that case; only the
  // request-time dev/prerender path (which DOES have the live mount) still
  // does a fresh ingest.
  let documents: ParsedContent[]
  let sourceIds: string[]
  let existingSnapshot: ContentSnapshot | undefined
  let existingValidation: ContentValidationReport | undefined

  if (usesProcessSnapshot) {
    const raw = await cacheStorage(event).getItem('snapshot.json')
    if (!isContentSnapshot(raw)) {
      throw new Error('[content] production snapshot missing or invalid — the site was built without a content snapshot. Rebuild with this package version.')
    }
    if (raw.integrity !== contentContext.cacheIntegrity) {
      throw new Error(`[content] snapshot integrity mismatch (built: ${raw.integrity}, runtime: ${contentContext.cacheIntegrity}) — stale build artifact.`)
    }
    documents = raw.documents
    sourceIds = raw.documentSourceIds
    existingSnapshot = raw
    const validation = await cacheStorage(event).getItem('validation.json')
    if (!isContentValidationReport(validation) || validation.integrity !== contentContext.cacheIntegrity) {
      throw new Error('[content] production validation report missing, invalid, or stale. Rebuild with this package version.')
    }
    existingValidation = validation
  } else {
    // Steps 2-3: enumerate mounted sources and ingest each through the real
    // transformer + parse-hook pipeline (integrations/nitro/ingest.ts).
    sourceIds = await getSourceContentIds(event)
    documents = []
    const unreadable = new Set<string>()

    for (const chunk of chunksFromArray(sourceIds, 10)) {
      const results = await Promise.all(chunk.map(async id => [id, await loadContentVariants(event, id)] as const))
      for (const [id, variants] of results) {
        const real = variants.filter(isRealDocument)
        if (!real.length) {
          unreadable.add(id)
          continue
        }
        documents.push(...real)
      }
    }

    // Steps 4-6: schema parsing and the JSON-purity gate already ran inside
    // `loadContentVariants` -> `parseContentVariants` -> `validateVariants`;
    // this asserts source completeness on what made it through.
    if (unreadable.size > 0) {
      const details = [...unreadable].slice(0, 20).map(id => `${id}: ${describeUnreadableSource()}`).join('; ')
      throw new Error(
        `[content] snapshot build failed: ${unreadable.size} source document(s) produced no servable content `
        + `and would silently 404 in production. First ${Math.min(unreadable.size, 20)} — ${details}`
      )
    }
  }

  // Step 7: build and validate the canonical graph.
  const graph = buildContentGraph(documents, {
    locales: contentContext.locales,
    defaultLocale: contentContext.defaultLocale
  })
  const graphValidation = validateContentGraph(documents, contentContext)
  if (!graphValidation.ok) {
    throw graphValidation.error
  }

  // Steps 8-10: per-collection locale policy, canonical route records (the
  // one projector), and alternate round-trip validation.
  const routes: ProjectedContentRouteRecord[] = []
  const routesByCollection: Record<string, number> = {}
  const sitemapByCollection: Record<string, number> = {}
  const routeCollections = resolveRouteCollections(collections)
  const sitemapCollections = new Set(resolveSitemapCollections(collections, contentContext.sitemap))
  const sitemapIncludeDrafts = resolveIncludeDrafts({
    environment: 'production',
    includeDrafts: contentContext.sitemap ? contentContext.sitemap.includeDrafts : undefined
  })

  for (const name of routeCollections) {
    const policy = routePolicyFor(name, contentContext)
    const facts = collectRouteFacts(graph, name)
    const { records, index } = buildRouteRecords(facts, policy)
    assertAlternateRoundTrips(name, facts, policy, index)

    routes.push(...records)
    routesByCollection[name] = records.length
    if (sitemapCollections.has(name)) {
      sitemapByCollection[name] = countSitemapRoutes(graph, name, sitemapIncludeDrafts)
    }
  }
  for (const name of sitemapCollections) {
    sitemapByCollection[name] ??= 0
  }

  const validation = existingValidation
    ?? await createValidationReport(
      event,
      documents,
      routes,
      graph,
      contentContext as ResolvedContentContext & { cacheIntegrity: string },
      now
    )

  // Construct and validate the snapshot — still in memory, nothing
  // durable yet. When reusing an already-published snapshot (see above),
  // it already passed this exact purity/completeness gate the one time it
  // was originally built — recomputing it from the identical document set
  // would only re-verify the same invariant a second time.
  const snapshot = existingSnapshot ?? buildContentSnapshot({
    integrity: contentContext.cacheIntegrity,
    documents,
    sourceIds,
    now
  })
  if (!existingSnapshot) {
    assertSnapshotComplete(snapshot, sourceIds)
  }

  return {
    snapshot,
    routes,
    validation,
    counts: {
      documents: documents.length,
      routesByCollection,
      sitemapByCollection
    }
  }
}

/** The one durable publication: called only after `buildContentResult` returns successfully. */
export const publishContentSnapshot = async (event: H3Event, result: ContentBuildResult): Promise<void> => {
  await cacheStorage(event).setItem('snapshot.json', result.snapshot)
}

export const publishContentValidationReport = async (event: H3Event, report: ContentValidationReport): Promise<void> => {
  await cacheStorage(event).setItem('validation.json', report)
}
