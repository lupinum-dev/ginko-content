import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import type { H3Event } from 'h3'
import { bindContentProvider } from '../../packages/content/src/public/provider'
import type { ContentDataSource } from '../../packages/content/src/public/data-source'
import { toContentProviderQuery } from '../../packages/content/src/public/provider-query'

const boundedQuery = () => {
  const query = toContentProviderQuery({ collection: 'docs' })
  query.plan.mode = 'all'
  query.plan.limit = 2
  return query
}

const event = () => {
  const request = new EventEmitter()
  const response = new EventEmitter()
  return { context: {}, node: { req: request, res: response } } as unknown as H3Event
}

describe('bindContentProvider', () => {
  it('lowers unbounded builder input to the fixed core query bounds', () => {
    expect(toContentProviderQuery({ collection: 'docs' }).plan.limit).toBe(100)
    expect(toContentProviderQuery({ collection: 'docs', first: true }).plan.limit).toBe(1)
    expect(toContentProviderQuery({ collection: 'docs', count: true }).plan.limit).toBeUndefined()
  })

  it('creates one immutable context per request and source under concurrency', async () => {
    const createContext = vi.fn(async () => Object.freeze({ requestId: 'one' }))
    const query = vi.fn(async (context) => ({
      data: { mode: 'cursor', result: [{ ...context, collection: 'docs', canonicalKey: 'a', locale: 'en', contentPath: '/a', body: null }], limit: 2, pageInfo: { endCursor: null, hasNext: false } },
      cache: false as const,
    }))
    const source = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: ['cursor'], maxPageSize: 100 },
      },
      query,
    } satisfies ContentDataSource<{ requestId: string }>
    const provider = bindContentProvider({ source, createContext })
    const requestEvent = event()

    await Promise.all([
      provider.query(requestEvent, boundedQuery()),
      provider.query(requestEvent, boundedQuery()),
    ])

    expect(createContext).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[0]?.[0]).toBe(query.mock.calls[1]?.[0])
    expect(Object.isFrozen(query.mock.calls[0]?.[0])).toBe(true)
  })

  it('rejects an oversized request before dispatch', async () => {
    const source = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 100 },
      },
      query: vi.fn(),
    } as unknown as ContentDataSource<null>
    const provider = bindContentProvider({ source, createContext: () => null })
    const query = boundedQuery()
    query.plan.limit = 101

    await expect(provider.query(event(), query)).rejects.toThrow(/limit/i)
    expect(source.query).not.toHaveBeenCalled()
  })

  it('does not treat normal request completion as an abort', async () => {
    let resolveBackend!: (value: unknown) => void
    const source = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 100 },
      },
      query: vi.fn(async () => await new Promise((resolve) => { resolveBackend = resolve })),
    } as unknown as ContentDataSource<null>
    const provider = bindContentProvider({ source, createContext: () => null })
    const requestEvent = event()
    const pending = provider.query(requestEvent, boundedQuery())

    await vi.waitUntil(() => source.query.mock.calls.length === 1)

    ;(requestEvent.node.req as unknown as EventEmitter).emit('close')
    resolveBackend({ data: { mode: 'cursor', result: [], limit: 2, pageInfo: { endCursor: null, hasNext: false } }, cache: false })

    await expect(pending).resolves.toMatchObject({ data: { result: [] } })
  })

  it('aborts disposed requests and ignores a late backend result', async () => {
    let observedSignal: AbortSignal | undefined
    let resolveBackend!: (value: unknown) => void
    const source = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 100 },
      },
      query: vi.fn(async (_context, _query, control) => {
        observedSignal = control.signal
        return await new Promise((resolve) => { resolveBackend = resolve })
      }),
    } as unknown as ContentDataSource<null>
    const provider = bindContentProvider({ source, createContext: () => null })
    const requestEvent = event()
    const pending = provider.query(requestEvent, boundedQuery())
    ;(requestEvent.node.res as unknown as EventEmitter).emit('close')

    await expect(pending).rejects.toThrow(/abort|disposed/i)
    expect(observedSignal?.aborted).toBe(true)
    resolveBackend({ data: { result: [] }, cache: false })
  })

  it('never exposes backend causes or secret-bearing error details', async () => {
    const source = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 100 },
      },
      query: vi.fn(async () => {
        throw Object.assign(new Error('Bearer top-secret'), {
          code: 'BACKEND_FAILURE',
          details: { field: 'password=top-secret', token: 'top-secret' },
          cause: { password: 'top-secret' },
        })
      }),
    } as unknown as ContentDataSource<null>
    const provider = bindContentProvider({ source, createContext: () => null })

    const error = await provider.query(event(), boundedQuery()).catch((cause) => cause)
    expect(error).toBeInstanceOf(Error)
    expect(JSON.stringify(error)).not.toContain('top-secret')
    expect(error).not.toHaveProperty('cause')
  })

  it('does not trust timeout-like text from backend errors', async () => {
    const source = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 100 },
      },
      query: vi.fn(async () => {
        throw new Error('backend timeout while using token=top-secret')
      }),
    } as unknown as ContentDataSource<null>
    const provider = bindContentProvider({ source, createContext: () => null })

    const error = await provider.query(event(), boundedQuery()).catch((cause) => cause)
    expect(error.message).toBe('Content data-source operation failed.')
    expect(JSON.stringify({ message: error.message, ...error })).not.toContain('top-secret')
  })

  it('rejects oversized query, navigation, and search results', async () => {
    const source = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 100 },
      },
      query: vi.fn(async () => ({
        data: { mode: 'cursor', result: [{}, {}, {}], limit: 2, pageInfo: { endCursor: null, hasNext: false } },
        cache: false as const,
      })),
      navigation: vi.fn(async () => ({
        data: Array.from({ length: 101 }, (_, index) => ({ title: String(index) })),
        cache: false as const,
      })),
      search: vi.fn(async () => ({
        data: Array.from({ length: 101 }, (_, index) => ({
          title: String(index),
          score: 1,
          route: { collection: 'docs', canonicalKey: String(index), locale: 'en', contentPath: `/${index}` },
        })),
        cache: false as const,
      })),
    } as unknown as ContentDataSource<null>
    const provider = bindContentProvider({ source, createContext: () => null })

    await expect(provider.query(event(), boundedQuery())).rejects.toMatchObject({ data: { code: 'RESULT_LIMIT_EXCEEDED' } })
    await expect(provider.navigation!(event(), boundedQuery())).rejects.toMatchObject({ data: { code: 'RESULT_LIMIT_EXCEEDED' } })
    await expect(provider.search!(event(), { term: 'x', collections: ['docs'] })).rejects.toMatchObject({ data: { code: 'RESULT_LIMIT_EXCEEDED' } })
  })

  it('validates site-data identity, JSON size, route progress, and cache credentials', async () => {
    const base = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 100 },
      },
      query: vi.fn(),
    }
    const siteData = bindContentProvider({
      source: {
        ...base,
        siteData: vi.fn(async () => ({
          data: { key: 'announcement', locale: 'de', data: 'x'.repeat(256 * 1024), updatedAt: -1 },
          cache: false as const,
        })),
      } as unknown as ContentDataSource<null>,
      createContext: () => null,
    })
    await expect(siteData.siteData!(event(), { key: 'announcement', locale: 'en' })).rejects.toMatchObject({
      data: { code: 'RESPONSE_INVALID' },
    })

    let routeCalls = 0
    const routes = bindContentProvider({
      source: {
        ...base,
        routes: vi.fn(async () => ({
          data: {
            items: [],
            nextCursor: ++routeCalls < 3 ? 'same' : null,
            snapshot: 'generation-1',
          },
          cache: false as const,
        })),
      } as unknown as ContentDataSource<null>,
      createContext: () => null,
    })
    await expect(routes.routes!(event())).rejects.toMatchObject({ data: { code: 'CURSOR_INVALID' } })

    const cache = bindContentProvider({
      source: {
        ...base,
        query: vi.fn(async () => ({
          data: { mode: 'cursor', result: [], limit: 2, pageInfo: { endCursor: null, hasNext: false } },
          cache: {
            tags: ['https://user:password@example.test/private'],
            paths: [],
            maxAge: null,
            swr: null,
            etag: null,
            lastModified: null,
          },
        })),
      } as unknown as ContentDataSource<null>,
      createContext: () => null,
    })
    await expect(cache.query(event(), boundedQuery())).rejects.toMatchObject({ data: { code: 'CACHE_HINT_INVALID' } })
  })

  it('rejects non-progressing route pages and oversized cursors', async () => {
    const base = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 100 },
      },
      query: vi.fn(),
    }
    const routes = vi.fn(async () => ({
      data: { items: [], nextCursor: 'page-2', snapshot: 'generation-1' },
      cache: false as const,
    }))
    const nonProgressing = bindContentProvider({
      source: {
        ...base,
        routes,
      } as unknown as ContentDataSource<null>,
      createContext: () => null,
    })
    await expect(nonProgressing.routes!(event())).rejects.toMatchObject({ data: { code: 'CURSOR_INVALID' } })
    expect(routes).toHaveBeenCalledOnce()

    const oversizedCursor = bindContentProvider({
      source: {
        ...base,
        routes: vi.fn(async () => ({
          data: { items: [], nextCursor: 'x'.repeat(257), snapshot: 'generation-1' },
          cache: false as const,
        })),
      } as unknown as ContentDataSource<null>,
      createContext: () => null,
    })
    await expect(oversizedCursor.routes!(event())).rejects.toMatchObject({ data: { code: 'CURSOR_INVALID' } })
  })

  it('stops route enumeration after request abort even when the source ignores its signal', async () => {
    const requestEvent = event()
    let calls = 0
    const source = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 100 },
      },
      query: vi.fn(),
      routes: vi.fn(async () => {
        calls += 1
        if (calls === 1) (requestEvent.node.res as unknown as EventEmitter).emit('close')
        return {
          data: { items: [], nextCursor: calls === 1 ? 'next' : null, snapshot: 'generation-1' },
          cache: false as const,
        }
      }),
    } as unknown as ContentDataSource<null>
    const provider = bindContentProvider({ source, createContext: () => null })

    await expect(provider.routes!(requestEvent)).rejects.toMatchObject({ code: 'BACKEND_ABORTED' })
    await new Promise(resolve => setImmediate(resolve))
    expect(source.routes).toHaveBeenCalledOnce()
  })
})
