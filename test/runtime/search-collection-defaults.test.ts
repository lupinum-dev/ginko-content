import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createBasicScenario } from '../harness/scenarios'
import { createInMemoryProvider } from '../harness/provider'
import { createTestEvent } from '../harness/event'
import {
  buildSearchIndex,
  clearSearchRecordsCache,
  resolveSearchCollections,
  serverSearchContent
} from '../../packages/content/src/runtime/server/search'

const mocks = vi.hoisted(() => ({
  getContentProvider: vi.fn(),
  serverQueryCollection: vi.fn()
}))

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: mocks.getContentProvider
}))

vi.mock('../../packages/content/src/runtime/server/provider-query', () => ({
  serverQueryCollection: mocks.serverQueryCollection
}))

const scenario = createBasicScenario()
const provider = createInMemoryProvider(scenario)

const createRuntime = (search: Record<string, unknown> = {}) => ({
  public: {
    content: {
      integrity: 'test'
    }
  },
  content: {
    ...scenario.runtime,
    search: {
      engine: 'minisearch',
      ignoredTags: ['pre'],
      filterQuery: { _draft: false, _partial: false },
      extraFields: [],
      ...search
    }
  }
})

describe('runtime search collection defaults', () => {
  beforeEach(() => {
    clearSearchRecordsCache()
    mocks.getContentProvider.mockReset()
    mocks.getContentProvider.mockResolvedValue(provider)
    mocks.serverQueryCollection.mockReset()
    mocks.serverQueryCollection.mockImplementation((_event, collection: string) => {
      const builder = {
        select: vi.fn(() => builder),
        where: vi.fn(() => builder),
        find: vi.fn(async () => scenario.documents.filter(document => document._collection === collection))
      }
      return builder
    })
    vi.stubGlobal('__ginkoTestRuntimeConfig', createRuntime())
  })

  test('defaults to route-backed public collections', () => {
    expect(resolveSearchCollections(createRuntime().content)).toEqual(['pages', 'docs', 'posts'])
    expect(resolveSearchCollections({
      collections: {
        pages: { type: 'page', source: ['index.md', 'guide/**/*.md'] },
        docs: { route: '/docs' },
        changelog: { sitemap: true },
        data: { type: 'data', source: 'data/*.yml', sitemap: false }
      }
    })).toEqual(['pages', 'docs', 'changelog'])
  })

  test('honors explicit search collections', () => {
    expect(resolveSearchCollections(createRuntime({ collections: ['data'] }).content)).toEqual(['data'])
    expect(resolveSearchCollections(createRuntime().content, ['data'])).toEqual(['data'])
  })

  test('builds default local search indexes without data-only records', async () => {
    const records = await buildSearchIndex(createTestEvent({ scenario, provider }), {
      ignoredTags: ['pre']
    })

    expect(records.map(record => record.title)).toEqual(
      expect.arrayContaining(['Ginko', 'Guide', 'Hello World'])
    )
    expect(records.map(record => record.title)).not.toContain('App config')
    expect(records.some(record => record.path.startsWith('/data'))).toBe(false)
  })

  test('server search content uses the same default collection boundary', async () => {
    const records = await serverSearchContent(createTestEvent({ scenario, provider }))

    expect(records.map(record => record._collection)).toEqual(
      expect.arrayContaining(['pages', 'docs', 'posts'])
    )
    expect(records.map(record => record._collection)).not.toContain('data')
    expect(mocks.serverQueryCollection.mock.calls.map(([, collection]) => collection)).toEqual(['pages', 'docs', 'posts'])
  })
})
