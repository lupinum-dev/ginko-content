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
  return { context: {}, node: { req: request } } as unknown as H3Event
}

describe('bindContentProvider', () => {
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
    ;(requestEvent.node.req as unknown as EventEmitter).emit('close')

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
          details: { field: 'title', token: 'top-secret' },
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
})
