import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../harness/event'

const mocks = vi.hoisted(() => ({
  buildSearchIndex: vi.fn(),
  searchRecords: vi.fn()
}))

const runtime = vi.hoisted(() => ({
  content: {
    search: {
      engine: 'minisearch',
      collections: ['docs'],
      ignoredTags: ['pre'],
      filterQuery: { published: true },
      extraFields: ['tags'],
      minisearch: {
        fields: ['title', 'content', 'tags'],
        storeFields: ['path', 'title', 'tags'],
        boost: { tags: 5, title: 1 },
        fuzzy: false,
        prefix: false
      }
    }
  }
}))

vi.stubGlobal('__ginkoTestRuntimeConfig', runtime)

vi.mock('../../packages/content/src/runtime/server/search', () => ({
  buildSearchIndex: mocks.buildSearchIndex,
  searchRecords: mocks.searchRecords
}))

describe('runtime search API boundaries', () => {
  beforeEach(() => {
    mocks.buildSearchIndex.mockReset()
    mocks.searchRecords.mockReset()
    runtime.content.search = {
      engine: 'minisearch',
      collections: ['docs'],
      ignoredTags: ['pre'],
      filterQuery: { published: true },
      extraFields: ['tags'],
      minisearch: {
        fields: ['title', 'content', 'tags'],
        storeFields: ['path', 'title', 'tags'],
        boost: { tags: 5, title: 1 },
        fuzzy: false,
        prefix: false
      }
    } as never
  })

  test('search-index API builds all-locale indexes when no locale query is provided', async () => {
    const records = [{ id: '/docs/search', collection: 'docs', title: 'Search' }]
    mocks.buildSearchIndex.mockResolvedValue(records)
    const handler = (await import('../../packages/content/src/runtime/server/api/search-index')).default

    await expect(handler(createTestEvent())).resolves.toBe(records)
    expect(mocks.buildSearchIndex).toHaveBeenCalledWith(expect.anything(), {
      collections: ['docs'],
      ignoredTags: ['pre'],
      extraFields: ['tags'],
      filterQuery: { published: true },
      locale: undefined,
      allLocales: true
    })
  })

  test('search-index API scopes generated indexes to an explicit locale', async () => {
    const records = [{ id: '/de/dokumentation/suche', collection: 'docs', title: 'Suche' }]
    mocks.buildSearchIndex.mockResolvedValue(records)
    const handler = (await import('../../packages/content/src/runtime/server/api/search-index')).default

    await expect(handler(createTestEvent({ query: { locale: 'de' } }))).resolves.toBe(records)
    expect(mocks.buildSearchIndex).toHaveBeenCalledWith(expect.anything(), {
      collections: ['docs'],
      ignoredTags: ['pre'],
      extraFields: ['tags'],
      filterQuery: { published: true },
      locale: 'de',
      allLocales: false
    })
  })

  test('search API runs local MiniSearch over generated records and caps user input length at the handler seam', async () => {
    const records = [{ id: '/docs/fallback', collection: 'docs', title: 'Fallback Lab' }]
    const results = [{ collection: 'docs', path: '/docs/fallback', title: 'Fallback Lab', score: 42 }]
    mocks.buildSearchIndex.mockResolvedValue(records)
    mocks.searchRecords.mockReturnValue(results)
    const handler = (await import('../../packages/content/src/runtime/server/api/search')).default
    const longTerm = 'fallback'.repeat(40)

    await expect(handler(createTestEvent({ query: { q: longTerm, locale: 'de' } }))).resolves.toBe(results)
    expect(mocks.buildSearchIndex).toHaveBeenCalledWith(expect.anything(), {
      collections: ['docs'],
      ignoredTags: ['pre'],
      extraFields: ['tags'],
      filterQuery: { published: true },
      locale: 'de',
      allLocales: false
    })
    expect(mocks.searchRecords).toHaveBeenCalledWith(records, longTerm.slice(0, 200), 'de', {
      fields: ['title', 'content', 'tags'],
      storeFields: ['path', 'title', 'tags'],
      boost: { tags: 5, title: 1 },
      fuzzy: false,
      prefix: false
    })
  })

  test('search and search-index APIs return empty arrays when search is disabled', async () => {
    runtime.content.search = false as never
    const search = (await import('../../packages/content/src/runtime/server/api/search')).default
    const searchIndex = (await import('../../packages/content/src/runtime/server/api/search-index')).default

    await expect(search(createTestEvent({ query: { q: 'fallback' } }))).resolves.toEqual([])
    await expect(searchIndex(createTestEvent())).resolves.toEqual([])
    expect(mocks.buildSearchIndex).not.toHaveBeenCalled()
    expect(mocks.searchRecords).not.toHaveBeenCalled()
  })
})
