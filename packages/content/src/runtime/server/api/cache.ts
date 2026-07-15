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
  routesByCollection: Record<string, number>
  sitemapByCollection: Record<string, number>
}

const escapeHtmlAttribute = (value: string) => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]!)

export const renderContentRouteLinks = (routes: readonly string[]) =>
  routes.map(path => `<a href="${escapeHtmlAttribute(path)}"></a>`).join('')

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
  const records = normalizeProviderRoutes(await provider.routes(event), provider.name)
    .filter(route => runtime.collections?.[route.collection]?.type !== 'data')
    .filter(route => includeDrafts || !route.draft)
  const routes = records.map(route => projectProviderRouteFact(route, runtime))
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
 * (`module/nitro-config.ts`) so it is one of the very first routes Nitro's
 * prerender crawler visits. During prerendering (`import.meta.prerender`)
 * its response is HTML containing one `<a href>` per canonical public route
 * this build just produced. Nitro's own crawler extracts those links from
 * ANY HTML response and queues them for generation (`nitropack`'s
 * `extractLinks`/`crawlLinks`, verified against `runParallel`'s live `Set`
 * consumption in `nitropack/dist/_chunks/parallel.mjs` — added entries are
 * picked up as long as the queue has not yet drained). This is the "Nitro
 * route injection requires in place of the deleted
 * module-time `module/derived-route-discovery.ts` reparser: prerender
 * routes now come from THIS build result instead of a second parse of the
 * content directory.
 *
 * Outside prerendering the response stays small JSON — counts and the
 * canonical public route paths, never the full document/snapshot payload
 *. Non-static
 * (`nuxi build`) hybrid builds cannot rely on the HTML/crawl-links seed above
 * (their main Nitro instance never crawls its own compiled bundle by
 * default), so `module/integration-hooks.ts`'s `compiled` hook instead calls
 * this JSON response directly against the just-compiled server bundle and
 * pushes `.routes` straight into `nitro.options.prerender.routes`.
 */
export default defineEventHandler(async (event) => {
  const start = Date.now()
  const runtime = getContentRuntimeConfig().content || {}
  if (runtime.provider && runtime.provider !== 'filesystem') {
    const seed = await buildExternalProviderRouteSeed(event)
    if (import.meta.prerender) {
      setHeader(event, 'content-type', 'text/html; charset=utf-8')
      const links = renderContentRouteLinks(seed.routes)
      return `<!doctype html><html><head><meta charset="utf-8"></head><body>${links}</body></html>`
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
  const publicRoutePaths = result.routes.filter(route => !route.draft).map(route => route.path)

  if (import.meta.prerender) {
    setHeader(event, 'content-type', 'text/html; charset=utf-8')
    const links = renderContentRouteLinks(publicRoutePaths)
    return `<!doctype html><html><head><meta charset="utf-8"></head><body>${links}</body></html>`
  }

  return {
    generatedAt: result.snapshot.generatedAt,
    documentCount: result.counts.documents,
    generateTime: Date.now() - start,
    routes: publicRoutePaths,
    routesByCollection: result.counts.routesByCollection,
    sitemapByCollection: result.counts.sitemapByCollection
  }
})
