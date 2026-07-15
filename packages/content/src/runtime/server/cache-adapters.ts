import type { H3Event } from 'h3'
import { setHeader } from 'h3'
import type { ContentCacheAdapter, ContentCacheHint } from '../../public/provider'

/**
 * Choosing a cache adapter:
 * - `noopContentCache` — the default. Both `apply` and `invalidate` are intentionally
 *   inert: the runtime still computes and stores a cache hint per request, but nothing
 *   is written to the response and no upstream cache is purged. Use when caching is
 *   handled entirely outside this module (a CDN/edge config you own) or disabled.
 * - `headersContentCache` — the active-`apply` adapter: writes `Cache-Control`/`ETag`/
 *   `Last-Modified` onto every content response from the hint. Use when this module
 *   should own response cache headers directly (self-hosted / generic CDN).
 */
export const noopContentCache = (): ContentCacheAdapter => ({
  name: 'noop',
  apply: () => {},
  invalidate: async () => {}
})

/**
 * Emits the per-request cache hint as HTTP response headers via {@link contentCacheHeaders}.
 * `invalidate` is a no-op: header-based caching has no upstream store to purge.
 */
export const headersContentCache = (): ContentCacheAdapter => ({
  name: 'headers',
  apply: (event: H3Event, hint: ContentCacheHint) => {
    const headers = contentCacheHeaders(hint)
    headers.forEach((value, key) => {
      setHeader(event, key, value)
    })
  },
  invalidate: async () => {}
})

export const contentCacheHeaders = (hint: ContentCacheHint) => {
  const headers = new Headers()
  if (typeof hint.maxAge === 'number') {
    const directives = [`max-age=${hint.maxAge}`]
    if (typeof hint.swr === 'number') {
      directives.push(`stale-while-revalidate=${hint.swr}`)
    }
    headers.set('Cache-Control', directives.join(', '))
  }
  if (hint.etag) {
    headers.set('ETag', hint.etag)
  }
  if (hint.lastModified) {
    headers.set('Last-Modified', hint.lastModified.toUTCString())
  }
  return headers
}
