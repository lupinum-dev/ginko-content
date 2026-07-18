import { describe, expect, it, vi } from 'vitest'

import type {
  BoundedContentProviderQuery,
  ContentDataSource,
} from '../../packages/content/src/public/data-source'
import { runContentDataSourceContract } from '../../packages/content/src/testing/data-source-contract'

const query: BoundedContentProviderQuery = {
  v: 3,
  collection: 'docs',
  plan: {
    mode: 'all',
    limit: 2,
    filter: { type: 'true' },
    sort: [],
    projection: { only: [], without: [] },
    skip: 0,
    paging: { mode: 'cursor', after: null, limit: 2 },
  },
}

describe('ContentDataSource v1', () => {
  it('runs one fixed bounded query contract with an abortable deadline', async () => {
    const execute = vi.fn(async (_context, _query, control) => {
      expect(control.signal).toBeInstanceOf(AbortSignal)
      expect(control.deadlineAt).toBeGreaterThan(Date.now())
      return {
        data: { mode: 'cursor', result: [], limit: 2, pageInfo: { endCursor: null, hasNext: false } },
        cache: false as const,
      }
    })
    const source = {
      name: 'fixture',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: ['$eq'], pagination: ['cursor'], maxPageSize: 100 },
      },
      query: execute,
    } satisfies ContentDataSource<{ requestId: string }>

    await expect(
      runContentDataSourceContract({ source, context: { requestId: 'one' }, query }),
    ).resolves.toBeUndefined()
    expect(execute).toHaveBeenCalledOnce()
  })

  it('rejects an advertised or requested limit above the core ceiling', async () => {
    const source = {
      name: 'fixture',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: [], maxPageSize: 101 },
      },
      query: vi.fn(),
    } as unknown as ContentDataSource<null>

    await expect(runContentDataSourceContract({ source, context: null, query })).rejects.toThrow(
      /Invalid Content data-source capabilities/,
    )
    expect(source.query).not.toHaveBeenCalled()

    const boundedSource = {
      ...source,
      capabilities: { ...source.capabilities, query: { ...source.capabilities.query, maxPageSize: 100 } },
    }
    await expect(
      runContentDataSourceContract({
        source: boundedSource,
        context: null,
        query: { ...query, plan: { ...query.plan, limit: 101 } },
      }),
    ).rejects.toThrow(/limit/i)
  })

  it('rejects a malformed query response inside an otherwise valid result envelope', async () => {
    const source = {
      name: 'fixture',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: ['cursor'], maxPageSize: 100 },
      },
      query: vi.fn(async () => ({
        data: { result: [] },
        cache: false as const,
      })),
    } as unknown as ContentDataSource<null>

    await expect(runContentDataSourceContract({ source, context: null, query })).rejects.toThrow(
      /invalid list response/i,
    )
  })

  it('rejects malformed cache metadata through the bound provider seam', async () => {
    const source = {
      name: 'fixture',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: [], pagination: ['cursor'], maxPageSize: 100 },
      },
      query: vi.fn(async () => ({
        data: { mode: 'cursor', result: [], limit: 2, pageInfo: { endCursor: null, hasNext: false } },
        cache: 'invalid',
      })),
    } as unknown as ContentDataSource<null>

    await expect(runContentDataSourceContract({ source, context: null, query })).rejects.toMatchObject({
      code: 'CACHE_HINT_INVALID'
    })
  })
})
