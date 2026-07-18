import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../harness/event'

const mocks = vi.hoisted(() => ({
  buildSearchIndex: vi.fn(),
  createMiniSearchIndex: vi.fn(),
  miniSearch: vi.fn(),
  getContentProvider: vi.fn()
}))

const runtime = vi.hoisted(() => ({
  content: {
    defaultLocale: 'en',
    locales: ['en', 'de'],
    collections: {
      docs: {
        i18n: { defaultLocale: 'en', locales: ['en', 'de'] }
      }
    },
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
  buildSearchIndex: mocks.buildSearchIndex
}))

vi.mock('../../packages/content/src/runtime/shared/search', () => ({
  createMiniSearchIndex: mocks.createMiniSearchIndex
}))

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: mocks.getContentProvider
}))

describe('runtime search API boundaries', () => {
  beforeEach(() => {
    mocks.buildSearchIndex.mockReset()
    mocks.createMiniSearchIndex.mockReset()
    mocks.miniSearch.mockReset()
    mocks.createMiniSearchIndex.mockReturnValue({ search: mocks.miniSearch })
    mocks.getContentProvider.mockReset()
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
    mocks.miniSearch.mockReturnValue(results)
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
    expect(mocks.createMiniSearchIndex).toHaveBeenCalledWith(records, {
      fields: ['title', 'content', 'tags'],
      storeFields: ['path', 'title', 'tags'],
      boost: { tags: 5, title: 1 },
      fuzzy: false,
      prefix: false
    })
    expect(mocks.miniSearch).toHaveBeenCalledWith(longTerm.slice(0, 200), { locale: 'de' })
  })

  test('search API delegates provider-owned search and normalizes result collections', async () => {
    runtime.content.search = {
      engine: 'provider',
      collections: ['docs']
    } as never
    const providerSearch = vi.fn(async () => [
      {
        title: 'Provider Deutscher Leitfaden',
        score: 1,
        route: {
          collection: 'docs',
          canonicalKey: 'docs:provider-guide',
          locale: 'de',
          contentPath: '/dokumentation/provider-leitfaden'
        }
      }
    ])
    mocks.getContentProvider.mockResolvedValue({
      name: 'cms-provider',
      search: providerSearch
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/search')).default
    const longTerm = 'provider'.repeat(40)

    await expect(handler(createTestEvent({ query: { q: longTerm, locale: 'de' } }))).resolves.toEqual([
      {
        collection: 'docs',
        excerpt: '',
        locale: 'de',
        path: '/de/dokumentation/provider-leitfaden',
        title: 'Provider Deutscher Leitfaden',
        score: 1
      }
    ])
    expect(providerSearch).toHaveBeenCalledWith(expect.anything(), {
      term: longTerm.slice(0, 200),
      locale: 'de',
      collections: ['docs']
    })
    expect(mocks.buildSearchIndex).not.toHaveBeenCalled()
    expect(mocks.createMiniSearchIndex).not.toHaveBeenCalled()
  })

  test('search API rejects provider route facts outside the configured search collections', async () => {
    runtime.content.search = {
      engine: 'provider',
      collections: ['docs']
    } as never
    mocks.getContentProvider.mockResolvedValue({
      name: 'cms-provider',
      search: vi.fn(async () => [{
        title: 'Wrong collection',
        score: 1,
        route: {
          collection: 'posts',
          canonicalKey: 'posts:wrong-collection',
          locale: 'en',
          contentPath: '/blog/wrong-collection'
        }
      }])
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/search')).default

    await expect(handler(createTestEvent({ query: { q: 'wrong' } }))).rejects.toMatchObject({
      statusMessage: 'provider_result_invalid',
      data: expect.objectContaining({
        operation: 'search',
        field: 'result[0].route.collection'
      })
    })
  })

  test('search API fails loudly when provider-owned search is selected without provider support', async () => {
    runtime.content.search = {
      engine: 'provider',
      collections: ['docs']
    } as never
    mocks.getContentProvider.mockResolvedValue({
      name: 'cms-provider'
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/search')).default

    await expect(handler(createTestEvent({ query: { q: 'provider' } }))).rejects.toMatchObject({
      statusMessage: 'unsupported_provider_search',
      data: expect.objectContaining({
        provider: 'cms-provider'
      })
    })
  })

  test('search and search-index APIs return empty arrays when search is disabled', async () => {
    runtime.content.search = false as never
    const search = (await import('../../packages/content/src/runtime/server/api/search')).default
    const searchIndex = (await import('../../packages/content/src/runtime/server/api/search-index')).default

    await expect(search(createTestEvent({ query: { q: 'fallback' } }))).resolves.toEqual([])
    await expect(searchIndex(createTestEvent())).resolves.toEqual([])
    expect(mocks.buildSearchIndex).not.toHaveBeenCalled()
    expect(mocks.createMiniSearchIndex).not.toHaveBeenCalled()
  })
})
