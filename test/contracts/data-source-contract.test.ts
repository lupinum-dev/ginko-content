import { describe, expect, it, vi } from 'vitest'

import type {
  BoundedContentProviderQuery,
  ContentDataSource,
} from '../../packages/content/src/public/data-source'
import {
  runContentDataSourceContract,
  runContentDataSourceContractSuite,
} from '../../packages/content/src/testing/data-source-contract'

const query: BoundedContentProviderQuery = {
  v: 5,
  collection: 'docs',
  plan: {
    mode: 'all',
    filter: { type: 'true' },
    sort: [],
    projection: { only: [], without: [] },
    pagination: { mode: 'cursor', after: null, limit: 2 },
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
        query: {
          ...query,
          plan: {
            ...query.plan,
            pagination: { ...query.plan.pagination, limit: 101 }
          }
        },
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

const firstQuery = (contentPath: string): BoundedContentProviderQuery => ({
  ...query,
  plan: {
    ...query.plan,
    mode: 'first',
    pagination: { mode: 'slice', skip: 0, limit: 1 },
    filter: { type: 'compare', field: 'path', operator: 'eq', value: contentPath },
  },
}) as BoundedContentProviderQuery

const contractDocument = {
  collection: 'docs',
  canonicalKey: 'docs:intro',
  locale: 'en',
  contentPath: '/docs/intro',
  body: null,
  title: 'Introduction',
}

describe('runContentDataSourceContractSuite', () => {
  runContentDataSourceContractSuite({
    name: 'in-memory fixture',
    loadSource: async () => ({
      name: 'fixture',
      capabilities: {
        protocol: 'ginko-content-data-source/v1',
        query: { operators: ['$eq'], pagination: ['cursor'], maxPageSize: 100 },
      },
      query: async (_context, request, control) => {
        expect(control.signal).toBeInstanceOf(AbortSignal)
        expect(control.deadlineAt).toBeGreaterThan(Date.now())
        if (request.plan.mode === 'first') {
          const expectedPath = request.plan.filter.type === 'compare'
            ? request.plan.filter.value
            : null
          return { data: { result: expectedPath === contractDocument.contentPath ? contractDocument : undefined }, cache: false }
        }
        const after = request.plan.pagination.mode === 'cursor' ? request.plan.pagination.after : null
        return {
          data: {
            mode: 'cursor',
            result: after ? [] : [contractDocument],
            limit: request.plan.pagination.limit,
            pageInfo: after
              ? { endCursor: null, hasNext: false }
              : { endCursor: 'page-2', hasNext: true },
          },
          cache: false,
        }
      },
    }),
    createContext: () => ({ requestId: 'contract' }),
    firstFound: {
      query: firstQuery('/docs/intro'),
      assertResult: result => expect(result).toMatchObject({ result: { contentPath: '/docs/intro' } }),
    },
    firstMissing: {
      query: firstQuery('/docs/missing'),
      assertResult: result => {
        expect(result).toHaveProperty('result')
        expect((result as { result: unknown }).result).toBeUndefined()
      },
    },
    list: {
      query,
      assertResult: result => expect(result).toMatchObject({ result: [{ contentPath: '/docs/intro' }] }),
    },
    cursor: {
      first: {
        query,
        assertResult: result => expect(result).toMatchObject({
          mode: 'cursor',
          pageInfo: { hasNext: true, endCursor: 'page-2' },
        }),
      },
      next: cursor => ({
        query: {
          ...query,
          plan: {
            ...query.plan,
            pagination: { mode: 'cursor', after: cursor, limit: 2 },
          },
        },
        assertResult: result => expect(result).toMatchObject({
          mode: 'cursor',
          result: [],
          pageInfo: { hasNext: false, endCursor: null },
        }),
      }),
    },
  })
})
