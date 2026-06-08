import { describe, expect, test, vi } from 'vitest'
import { mergeContentCacheHints, normalizeContentCacheHint } from '../../packages/content/src/core/cache-hints'
import { contentCacheHeaders, noopContentCache, vercelContentCache } from '../../packages/content/src/runtime/server/cache-adapters'

describe('content cache hints', () => {
  test('normalizes and deduplicates tags and paths', () => {
    expect(normalizeContentCacheHint({
      tags: ['entry:docs:intro', 'entry:docs:intro', ''],
      paths: ['docs/intro', '/docs/intro', '//docs//intro']
    })).toMatchObject({
      tags: ['entry:docs:intro'],
      paths: ['/docs/intro']
    })
  })

  test('merges with safest freshness and newest last modified', () => {
    expect(mergeContentCacheHints({
      tags: ['collection:docs'],
      paths: ['/docs'],
      maxAge: 300,
      swr: 3600,
      lastModified: new Date('2026-01-01T00:00:00Z'),
      etag: 'old'
    }, {
      tags: ['entry:docs:intro'],
      paths: ['docs/intro'],
      maxAge: 60,
      swr: 120,
      lastModified: new Date('2026-01-02T00:00:00Z'),
      etag: 'new'
    })).toEqual({
      tags: ['collection:docs', 'entry:docs:intro'],
      paths: ['/docs', '/docs/intro'],
      maxAge: 60,
      swr: 120,
      lastModified: new Date('2026-01-02T00:00:00Z'),
      etag: 'new'
    })
  })

  test('cache opt-out wins permanently', () => {
    expect(mergeContentCacheHints({ tags: ['collection:docs'] }, false)).toBe(false)
    expect(mergeContentCacheHints(false, { tags: ['collection:docs'] })).toBe(false)
  })

  test('creates portable cache headers from freshness hints', () => {
    const headers = contentCacheHeaders({
      maxAge: 60,
      swr: 120,
      etag: 'abc',
      lastModified: new Date('2026-01-02T00:00:00Z')
    })

    expect(headers.get('Cache-Control')).toBe('max-age=60, stale-while-revalidate=120')
    expect(headers.get('ETag')).toBe('abc')
    expect(headers.get('Last-Modified')).toBe('Fri, 02 Jan 2026 00:00:00 GMT')
  })

  test('vercel adapter revalidates exact public paths with the bypass token', async () => {
    const requests: Array<{ url: string, method?: string, token: string | null }> = []
    const adapter = vercelContentCache({
      origin: 'https://example.com/',
      bypassToken: 'secret',
      fetch: (async (url, init) => {
        requests.push({
          url: String(url),
          method: init?.method,
          token: new Headers(init?.headers).get('x-prerender-revalidate')
        })
        return new Response(null, { status: 204 })
      }) as typeof globalThis.fetch
    })

    await adapter.invalidate({ paths: ['docs/a', '/docs/a', '/docs/b'], tags: ['entry:docs:a'] })

    expect(requests).toEqual([
      { url: 'https://example.com/docs/a', method: 'HEAD', token: 'secret' },
      { url: 'https://example.com/docs/b', method: 'HEAD', token: 'secret' }
    ])
  })

  test('noop adapter accepts tag-only and path invalidation without side effects', async () => {
    const adapter = noopContentCache()

    expect(adapter.name).toBe('noop')
    expect(adapter.apply({ tags: ['entry:docs:a'], paths: ['/docs/a'] })).toBeUndefined()
    await expect(adapter.invalidate({ tags: ['entry:docs:a'] })).resolves.toBeUndefined()
    await expect(adapter.invalidate({ paths: ['/docs/a'] })).resolves.toBeUndefined()
  })

  test('tag-capable adapters can explicitly accept tag-only invalidation', async () => {
    const invalidations: unknown[] = []
    const adapter = {
      name: 'tag-capable',
      apply: vi.fn(),
      invalidate: vi.fn(async input => {
        invalidations.push(input)
      })
    }

    await adapter.invalidate({ tags: ['entry:docs:a'] })

    expect(invalidations).toEqual([{ tags: ['entry:docs:a'] }])
  })

  test('vercel adapter fails loudly when a path cannot be revalidated', async () => {
    const adapter = vercelContentCache({
      origin: 'https://example.com',
      bypassToken: 'secret',
      fetch: (async () => new Response(null, { status: 401, statusText: 'Unauthorized' })) as typeof globalThis.fetch
    })

    await expect(adapter.invalidate({ paths: ['/docs/a'] })).rejects.toThrow('Failed to revalidate Vercel ISR path "/docs/a": 401 Unauthorized')
  })

  test('vercel adapter rejects tag-only invalidation', async () => {
    const adapter = vercelContentCache({
      origin: 'https://example.com',
      bypassToken: 'secret',
      fetch: vi.fn() as unknown as typeof globalThis.fetch
    })

    await expect(adapter.invalidate({ tags: ['entry:docs:a'] })).rejects.toThrow('Vercel ISR revalidation requires explicit paths')
  })
})
