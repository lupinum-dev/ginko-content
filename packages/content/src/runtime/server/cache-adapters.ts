import type { H3Event } from 'h3'
import { setHeader } from 'h3'
import type { ContentCacheAdapter, ContentCacheHint } from '../../public/provider'

/**
 * Emits the per-request cache hint as HTTP response headers via {@link contentCacheHeaders}.
 * Header-based caching has no upstream store to purge, so this adapter deliberately
 * does not advertise the optional invalidation capability.
 */
export const headersContentCache = (): ContentCacheAdapter => ({
  name: 'headers',
  apply: (event: H3Event, hint: ContentCacheHint) => {
    const headers = contentCacheHeaders(hint)
    headers.forEach((value, key) => {
      setHeader(event, key, value)
    })
  }
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
