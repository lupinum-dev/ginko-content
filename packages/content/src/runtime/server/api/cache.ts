import { defineEventHandler, setHeader, type H3Event } from 'h3'
import { buildContentResult, publishContentSnapshot, publishContentValidationReport } from '../../../integrations/nitro/build'
import { usesProcessSnapshot } from '../../../storage/snapshot-runtime'
import { createContentProviderError } from '../../../public/provider-errors'
import { resolveIncludeDrafts } from '../../../core/visibility'
import { getContentProvider } from '../providers'
import { normalizeProviderRoutes, projectProviderRouteFact } from '../provider-route-facts'
import { getContentRuntimeConfig } from '../runtime-config'
import { ContentError } from '../../../core/errors'

interface ContentRouteSeed {
  generatedAt: number
  documentCount: number
  routes: string[]
  prerenderRoutes: string[]
  routesByCollection: Record<string, number>
  sitemapByCollection: Record<string, number>
}

interface PrerenderRouteCandidate {
  collection: string
  path: string
}

/**
 * Public routes to seed into Nitro's prerender queue: none when the module
 * option `prerender` is `false`, and never routes of a collection declared
 * with `prerender: false`.
 */
export const selectPrerenderRoutes = (
  routes: readonly PrerenderRouteCandidate[],
  runtime: { prerender?: { routes?: boolean }, collections?: Record<string, { prerender?: boolean }> }
) => runtime.prerender?.routes === false
  ? []
  : routes.filter(route => runtime.collections?.[route.collection]?.prerender !== false).map(route => route.path)

/**
 * Nitro queues every path listed in an HTML response's `x-nitro-prerender`
 * header, whether or not `prerender.crawlLinks` is enabled. Paths are
 * percent-encoded because Nitro splits the header on commas and decodes each
 * entry with `decodeURIComponent`.
 */
export const encodePrerenderHeader = (routes: readonly string[]) =>
  routes.map(path => encodeURIComponent(path)).join(',')

const respondWithPrerenderSeed = (event: H3Event, routes: readonly string[]) => {
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  if (routes.length) {
    setHeader(event, 'x-nitro-prerender', encodePrerenderHeader(routes))
  }
  return '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'
}

/**
 * External providers have no filesystem snapshot to build. Their optional
 * `routes()` method is the canonical build-time enumeration seam, so this
 * endpoint can seed Nitro without adding module-time route discovery.
 */
const buildExternalProviderRouteSeed = async (event: H3Event): Promise<ContentRouteSeed> => {
  const provider = await getContentProvider(event)
  if (!provider.routes) {
    throw createContentProviderError(
      'unsupported_provider_prerender',
      `${provider.name} must implement routes() when content prerendering is enabled.`,
      { provider: provider.name, operation: 'routes' }
    )
  }

  const runtime = getContentRuntimeConfig().content || {}
  const includeDrafts = resolveIncludeDrafts({ environment: 'production' })
  const records = normalizeProviderRoutes(await provider.routes(event), provider.name, runtime)
    .filter(route => runtime.collections?.[route.collection]?.type !== 'data')
    .filter(route => includeDrafts || !route.draft)
  const projected = records.map(route => ({ collection: route.collection, path: projectProviderRouteFact(route, runtime) }))
  const routes = projected.map(route => route.path)
  const routesByCollection: Record<string, number> = {}
  const sitemapByCollection: Record<string, number> = {}

  for (const route of records) {
    routesByCollection[route.collection] = (routesByCollection[route.collection] || 0) + 1
    if (route.sitemap !== false) {
      sitemapByCollection[route.collection] = (sitemapByCollection[route.collection] || 0) + 1
    }
  }

  return {
    generatedAt: Date.now(),
    documentCount: 0,
    routes,
    prerenderRoutes: selectPrerenderRoutes(projected, runtime),
    routesByCollection,
    sitemapByCollection
  }
}

/**
 * The canonical Nitro-side content build endpoint.
 *
 * Runs the real ingest pipeline end to end and validates every document,
 * the graph, routes, and alternates BEFORE anything is persisted
 * (`buildContentResult`). Only after that succeeds does this handler
 * perform the one durable `snapshot.json` write (`publishContentSnapshot`).
 * If `buildContentResult` throws — a parse, schema, JSON-purity, graph, or
 * route/alternate failure — this handler never reaches the write, so a
 * failed build can never leave a partial or stale snapshot behind
 *.
 *
 * This route is unshifted to the front of `nitro.prerender.routes`
 * (`module/nitro-config.ts`). During prerendering (`import.meta.prerender`)
 * it answers with a minimal HTML page whose `x-nitro-prerender` header lists
 * the public routes this build produced (see `selectPrerenderRoutes`).
 * Nitro reads that header from every prerendered HTML response and queues
 * the listed routes, independent of `prerender.crawlLinks`, while its queue
 * is still draining. Prerender routes therefore come from this validated
 * build result without a second content parse.
 *
 * Outside prerendering the response stays small JSON — counts and the
 * canonical public route paths, never the full document/snapshot payload.
 * `module/integration-hooks.ts` reads those counts for sitemap assertions.
 */
export default defineEventHandler(async (event) => {
  const start = Date.now()
  const runtime = getContentRuntimeConfig().content || {}
  if (runtime.provider && runtime.provider !== 'filesystem') {
    const { prerenderRoutes, ...seed } = await buildExternalProviderRouteSeed(event)
    if (import.meta.prerender) {
      return respondWithPrerenderSeed(event, prerenderRoutes)
    }
    return { ...seed, generateTime: Date.now() - start }
  }

  const result = await buildContentResult(event)
  if (!usesProcessSnapshot) {
    await publishContentValidationReport(event, result.validation)
  }
  const validationErrors = result.validation.findings.filter(finding => finding.severity === 'error')
  if (runtime.validation === 'error' && validationErrors.length) {
    throw new ContentError(
      'VALIDATION_FAILED',
      `[content] authored content validation failed with ${validationErrors.length} error(s). Run \`ginko-content validate\` for details.`,
      { findings: validationErrors }
    )
  }
  // A genuinely compiled production main instance (`usesProcessSnapshot`) has
  // no live `content:source` mount to re-derive from at all, so
  // `buildContentResult` reuses the already-published snapshot as-is there
  // instead of building a new one (see its doc comment) -- publishing it
  // again would just rewrite the identical durable artifact (and possibly
  // fail outright against a read-only bundled storage driver in real
  // production). Only publish when this call actually built a fresh one.
  if (!usesProcessSnapshot) {
    await publishContentSnapshot(event, result)
  }
  const publicRoutes = result.routes.filter(route => !route.draft)

  if (import.meta.prerender) {
    return respondWithPrerenderSeed(event, selectPrerenderRoutes(publicRoutes, runtime))
  }

  return {
    generatedAt: result.snapshot.generatedAt,
    documentCount: result.counts.documents,
    generateTime: Date.now() - start,
    routes: publicRoutes.map(route => route.path),
    routesByCollection: result.counts.routesByCollection,
    sitemapByCollection: result.counts.sitemapByCollection
  }
})
