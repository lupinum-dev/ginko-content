import type { ContentCacheAdapter, ContentCacheHint, ContentCacheInvalidateInput } from '../../public/provider'

export const noopContentCache = (): ContentCacheAdapter => ({
  name: 'noop',
  apply: () => {},
  invalidate: async () => {}
})

export interface VercelContentCacheOptions {
  origin: string
  bypassToken: string
  fetch?: typeof globalThis.fetch
}

export const vercelContentCache = (options: VercelContentCacheOptions): ContentCacheAdapter => {
  const origin = options.origin.replace(/\/$/, '')
  const fetchImpl = options.fetch || globalThis.fetch

  return {
    name: 'vercel',
    apply: () => {},
    invalidate: async (input: ContentCacheInvalidateInput) => {
      const paths = Array.from(new Set((input.paths || [])
        .filter(path => typeof path === 'string' && path.trim())
        .map(path => path.startsWith('/') ? path : `/${path}`)))

      if (!paths.length && input.tags?.length) {
        throw new Error('Vercel ISR revalidation requires explicit paths; tag-only invalidation must be resolved before calling the adapter.')
      }

      await Promise.all(paths.map(async (path) => {
        const response = await fetchImpl(`${origin}${path}`, {
          method: 'HEAD',
          headers: {
            'x-prerender-revalidate': options.bypassToken
          }
        })
        if (!response.ok) {
          throw new Error(`Failed to revalidate Vercel ISR path "${path}": ${response.status} ${response.statusText}`.trim())
        }
      }))
    }
  }
}

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
