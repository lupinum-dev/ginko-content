import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import type { H3Event } from 'h3'
import { bindContentProvider, isContentProviderResult } from '../../packages/content/src/public/provider'
import {
  CONTENT_DATA_SOURCE_LIMITS,
  createContentDataSourceError,
  type ContentDataSource,
} from '../../packages/content/src/public/data-source'
import { toContentProviderQuery } from '../../packages/content/src/public/provider-query'

const boundedQuery = () => {
  const query = toContentProviderQuery({ collection: 'docs' })
  query.plan.mode = 'all'
  query.plan.pagination.limit = 2
  return query
}

const event = () => {
  const request = new EventEmitter()
  const response = new EventEmitter()
  return { context: {}, node: { req: request, res: response } } as unknown as H3Event
}

const decomposedValueOver = (maximumBytes: number) =>
  'e\u0301'.repeat(Math.floor(maximumBytes / 3) + 1)

const expectOnlyRawUtf8ToExceed = (value: string, maximumBytes: number) => {
  const encoder = new TextEncoder()
  expect(encoder.encode(value).length).toBeGreaterThan(maximumBytes)
  expect(encoder.encode(value.normalize('NFC')).length).toBeLessThanOrEqual(maximumBytes)
}

describe('bindContentProvider', () => {
  it('lowers unbounded builder input to the fixed core query bounds', () => {
    expect(toContentProviderQuery({ collection: 'docs' }).plan.pagination.limit).toBe(100)
    expect(toContentProviderQuery({ collection: 'docs', first: true }).plan.pagination.limit).toBe(1)
    expect(toContentProviderQuery({ collection: 'docs', count: true }).plan.pagination.limit).toBeUndefined()
  })

  it('rejects malformed data-source capabilities and methods at bind time', () => {
    const valid = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 100 },
      },
      query: vi.fn(),
    }
    const invalid = [
      { ...valid, capabilities: { ...valid.capabilities, query: undefined } },
      { ...valid, capabilities: { ...valid.capabilities, query: { ...valid.capabilities.query, operators: ['$eq', 1] } } },
      { ...valid, capabilities: { ...valid.capabilities, query: { ...valid.capabilities.query, operators: ['$madeUp'] } } },
      { ...valid, capabilities: { ...valid.capabilities, query: { ...valid.capabilities.query, operators: ['$and'] } } },
      { ...valid, capabilities: { ...valid.capabilities, query: { ...valid.capabilities.query, operators: ['$eq', '$eq'] } } },
      { ...valid, capabilities: { ...valid.capabilities, query: { ...valid.capabilities.query, pagination: ['page'] } } },
      { ...valid, capabilities: { ...valid.capabilities, query: { ...valid.capabilities.query, pagination: ['offset', 'offset'] } } },
      { ...valid, query: true },
      { ...valid, search: true },
    ]

    for (const source of invalid) {
      expect(() => bindContentProvider({
        source: source as unknown as ContentDataSource<null>,
        createContext: () => null,
      })).toThrow(/Invalid Content data-source/)
    }

    expect(() => bindContentProvider({
      source: valid as ContentDataSource<null>,
      createContext: true as unknown as () => null,
    })).toThrow(/Invalid Content data-source/)
  })

  it('omits unsupported optional operations from the bound provider', () => {
    const provider = bindContentProvider({
      source: {
        name: 'cms',
        capabilities: {
          protocol: 'ginko-content-data-source/v1',
          query: { operators: [], pagination: [], maxPageSize: 100 },
        },
        query: vi.fn(),
      } as unknown as ContentDataSource<null>,
      createContext: () => null,
    })

    expect(Object.keys(provider).sort()).toEqual(['capabilities', 'name', 'query'])
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
    query.plan.pagination.limit = 101

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

  it('never trusts or exposes backend code fields, status, causes, or secret details', async () => {
    const backendErrors = [
      Object.assign(new Error('Bearer code-secret'), {
        code: 'RESULT_LIMIT_EXCEEDED',
        statusCode: 418,
        details: { field: 'password=code-secret' },
        cause: { password: 'code-secret' },
      }),
      Object.assign(new Error('Bearer status-secret'), {
        statusMessage: 'PRIVATE_BACKEND_STATUS',
        statusCode: 404,
      }),
      Object.assign(new Error('Bearer data-secret'), {
        data: { code: 'DATABASE_SHARD_A', token: 'data-secret' },
        statusCode: 503,
      }),
    ]

    for (const backendError of backendErrors) {
      const source = {
        name: 'cms',
        capabilities: {
          protocol: 'ginko-content-data-source/v1',
          query: { operators: [], pagination: [], maxPageSize: 100 },
        },
        query: vi.fn(async () => { throw backendError }),
      } as unknown as ContentDataSource<null>
      const provider = bindContentProvider({ source, createContext: () => null })

      const error = await provider.query(event(), boundedQuery()).catch((cause) => cause)
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({
        message: 'Content data-source operation failed.',
        code: 'BACKEND_FAILURE',
        statusCode: 502,
        statusMessage: 'BACKEND_FAILURE',
        data: { code: 'BACKEND_FAILURE' },
      })
      expect(JSON.stringify(error)).not.toMatch(/code-secret|status-secret|data-secret|RESULT_LIMIT_EXCEEDED|PRIVATE_BACKEND_STATUS|DATABASE_SHARD_A/)
      expect(error).not.toHaveProperty('cause')
      expect(error).not.toHaveProperty('details')
    }
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
    const normalizedSiteData = bindContentProvider({
      source: {
        ...base,
        siteData: vi.fn(async () => ({
          data: { key: 'announcement', locale: null, data: { enabled: true }, updatedAt: null },
          cache: false as const,
        })),
      } satisfies ContentDataSource<null>,
      createContext: () => null,
    })
    const normalizedResult = await normalizedSiteData.siteData!(event(), { key: 'announcement' })
    expect(isContentProviderResult(normalizedResult)).toBe(true)
    if (isContentProviderResult(normalizedResult)) {
      expect(normalizedResult.data).toEqual({
        data: { enabled: true },
      })
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

    const nonJsonSiteData = bindContentProvider({
      source: {
        ...base,
        siteData: vi.fn(async () => ({
          data: { key: 'announcement', locale: null, data: new Date(), updatedAt: null },
          cache: false as const,
        })),
      } as unknown as ContentDataSource<null>,
      createContext: () => null,
    })
    await expect(nonJsonSiteData.siteData!(event(), { key: 'announcement' })).rejects.toMatchObject({
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
    await expect(routes.routes!(event())).rejects.toMatchObject({ data: { code: 'ROUTE_ENUMERATION_INVALID' } })

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

  it('measures ETag bytes without normalization and retains NFC-only cache keys', async () => {
    const oversizedDecomposed = decomposedValueOver(CONTENT_DATA_SOURCE_LIMITS.maxCacheKeyBytes)
    expectOnlyRawUtf8ToExceed(oversizedDecomposed, CONTENT_DATA_SOURCE_LIMITS.maxCacheKeyBytes)
    const cacheHints = [
      {
        tags: [],
        paths: [],
        maxAge: null,
        swr: null,
        etag: oversizedDecomposed,
        lastModified: null,
      },
      {
        tags: ['e\u0301'],
        paths: [],
        maxAge: null,
        swr: null,
        etag: null,
        lastModified: null,
      },
      {
        tags: [],
        paths: ['/e\u0301'],
        maxAge: null,
        swr: null,
        etag: null,
        lastModified: null,
      },
    ]

    for (const cache of cacheHints) {
      const source = {
        name: 'cms',
        capabilities: {
          protocol: 'ginko-content-data-source/v1',
          query: { operators: [], pagination: [], maxPageSize: 100 },
        },
        query: vi.fn(async () => ({
          data: { mode: 'cursor', result: [], limit: 2, pageInfo: { endCursor: null, hasNext: false } },
          cache,
        })),
      } as unknown as ContentDataSource<null>
      const provider = bindContentProvider({ source, createContext: () => null })

      await expect(provider.query(event(), boundedQuery())).rejects.toMatchObject({
        data: { code: 'CACHE_HINT_INVALID' },
      })
    }
  })

  it('measures serialized site-data bytes without normalization', async () => {
    const data = decomposedValueOver(CONTENT_DATA_SOURCE_LIMITS.maxSiteDataBytes)
    expectOnlyRawUtf8ToExceed(JSON.stringify(data), CONTENT_DATA_SOURCE_LIMITS.maxSiteDataBytes)
    const source = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 100 },
      },
      query: vi.fn(),
      siteData: vi.fn(async () => ({
        data: { key: 'announcement', locale: null, data, updatedAt: null },
        cache: false as const,
      })),
    } as unknown as ContentDataSource<null>
    const provider = bindContentProvider({ source, createContext: () => null })

    await expect(provider.siteData!(event(), { key: 'announcement' })).rejects.toMatchObject({
      data: { code: 'RESULT_LIMIT_EXCEEDED' },
    })
  })

  it('measures route snapshot and cursor bytes without normalization', async () => {
    const oversizedDecomposed = decomposedValueOver(CONTENT_DATA_SOURCE_LIMITS.maxCacheKeyBytes)
    expectOnlyRawUtf8ToExceed(oversizedDecomposed, CONTENT_DATA_SOURCE_LIMITS.maxCacheKeyBytes)
    const pages = [
      {
        items: [],
        nextCursor: null,
        snapshot: oversizedDecomposed,
      },
      {
        items: [{ collection: 'docs', canonicalKey: 'a', locale: 'en', contentPath: '/a' }],
        nextCursor: oversizedDecomposed,
        snapshot: 'generation-1',
      },
    ]

    for (const page of pages) {
      const source = {
        name: 'cms',
        capabilities: {
          protocol: 'ginko-content-data-source/v1',
          query: { operators: [], pagination: [], maxPageSize: 100 },
        },
        query: vi.fn(),
        routes: vi.fn(async () => ({ data: page, cache: false as const })),
      } as unknown as ContentDataSource<null>
      const provider = bindContentProvider({ source, createContext: () => null })

      await expect(provider.routes!(event())).rejects.toMatchObject({
        data: { code: 'ROUTE_ENUMERATION_INVALID' },
      })
    }
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
    await expect(nonProgressing.routes!(event())).rejects.toMatchObject({ data: { code: 'ROUTE_ENUMERATION_INVALID' } })
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
    await expect(oversizedCursor.routes!(event())).rejects.toMatchObject({ data: { code: 'ROUTE_ENUMERATION_INVALID' } })
  })

  it('surfaces only closed data-source failures', async () => {
    for (const [code, statusCode] of [['QUERY_CURSOR_INVALID', 400], ['BACKEND_FAILURE', 502]] as const) {
      const source = {
        name: 'cms',
        capabilities: {
          protocol: 'ginko-content-data-source/v1',
          query: { operators: [], pagination: ['cursor'], maxPageSize: 100 },
        },
        query: vi.fn(async () => { throw createContentDataSourceError(code) }),
      } satisfies ContentDataSource<null>
      const provider = bindContentProvider({ source, createContext: () => null })

      await expect(provider.query(event(), boundedQuery())).rejects.toMatchObject({
        statusCode,
        data: { code },
      })
    }
  })

  it('bounds each route record, sitemap images, and aggregate serialized bytes', async () => {
    const route = (index: number, extra: Record<string, unknown> = {}) => ({
      collection: 'docs',
      canonicalKey: `docs-${index}`,
      locale: 'en',
      contentPath: `/docs/${index}`,
      ...extra,
    })
    const cases = [
      {
        item: route(1, { padding: 'x'.repeat(CONTENT_DATA_SOURCE_LIMITS.maxRouteRecordBytes) }),
        code: 'RESULT_LIMIT_EXCEEDED',
      },
      {
        item: route(2, {
          sitemap: {
            images: Array.from({ length: CONTENT_DATA_SOURCE_LIMITS.maxSitemapImagesPerRoute + 1 }, (_, index) => ({ loc: `/image-${index}.png` })),
          },
        }),
        code: 'RESULT_LIMIT_EXCEEDED',
      },
      {
        item: route(3, {
          sitemap: { images: [{ loc: `/${'x'.repeat(CONTENT_DATA_SOURCE_LIMITS.maxSitemapImageLocationBytes)}.png` }] },
        }),
        code: 'RESULT_LIMIT_EXCEEDED',
      },
    ]

    for (const scenario of cases) {
      const source = {
        name: 'cms',
        capabilities: {
          protocol: 'ginko-content-data-source/v1',
          query: { operators: [], pagination: [], maxPageSize: 100 },
        },
        query: vi.fn(),
        routes: vi.fn(async () => ({
          data: { items: [scenario.item], nextCursor: null, snapshot: 'generation-1' },
          cache: false as const,
        })),
      } as unknown as ContentDataSource<null>
      const provider = bindContentProvider({ source, createContext: () => null })
      await expect(provider.routes!(event())).rejects.toMatchObject({ data: { code: scenario.code } })
    }

    const padding = 'x'.repeat(63 * 1024)
    const totalRecords = Math.ceil(CONTENT_DATA_SOURCE_LIMITS.maxTotalRouteBytes / (63 * 1024)) + 1
    const records = Array.from({ length: totalRecords }, (_, index) => route(index, { padding }))
    let offset = 0
    const source = {
      name: 'cms',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 100 },
      },
      query: vi.fn(),
      routes: vi.fn(async (_context, request) => {
        const items = records.slice(offset, offset + request.limit)
        offset += items.length
        return {
          data: {
            items,
            nextCursor: offset < records.length ? String(offset) : null,
            snapshot: 'generation-1',
          },
          cache: false as const,
        }
      }),
    } as unknown as ContentDataSource<null>
    const provider = bindContentProvider({ source, createContext: () => null })
    await expect(provider.routes!(event())).rejects.toMatchObject({ data: { code: 'RESULT_LIMIT_EXCEEDED' } })
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
