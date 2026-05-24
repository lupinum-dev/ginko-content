import { beforeEach, describe, expect, test, vi } from 'vitest'

const fetchCalls: unknown[] = []
let fetchPayload: unknown = []

const setRuntimeSearch = (search: unknown) => {
  ;(globalThis as Record<string, unknown>).__nuxtRuntimeConfig = {
    public: {
      content: {
        search
      }
    },
    app: {
      baseURL: '/'
    }
  }
}

describe('public search composables', () => {
  beforeEach(() => {
    vi.resetModules()
    fetchCalls.length = 0
    fetchPayload = []
    ;(globalThis as Record<string, unknown>).__nuxtUseFetch = (url: unknown) => {
      fetchCalls.push(url)
      return {
        data: { value: fetchPayload },
        error: { value: null },
        pending: { value: false }
      }
    }
  })

  test('useContentSearchResults loads MiniSearch indexes and filters results by locale', async () => {
    setRuntimeSearch({
      engine: 'minisearch',
      indexURL: '/api/_content/search/index.json'
    })
    fetchPayload = [
      {
        id: '/docs/fallback#overview',
        path: '/docs/fallback',
        title: 'Fallback Lab',
        excerpt: 'Fallback behavior',
        content: 'Fallback route matching',
        headings: ['Overview'],
        anchor: 'overview',
        locale: 'en'
      },
      {
        id: '/de/dokumentation/fallback#ueberblick',
        path: '/de/dokumentation/fallback',
        title: 'Fallback Labor',
        excerpt: 'Fallback Verhalten',
        content: 'Fallback Routen',
        headings: ['Ueberblick'],
        anchor: 'ueberblick',
        locale: 'de'
      }
    ]
    const { useContentSearchResults } = await import('../../packages/content/src/runtime/app/composables/search')

    const result = await useContentSearchResults('fallback', { locale: 'de' })

    expect((fetchCalls[0] as { value: string }).value).toBe('/api/_content/search/index.json?locale=de')
    expect(result.pending.value).toBe(false)
    expect(result.error.value).toBe(null)
    expect(result.results.value).toEqual([
      expect.objectContaining({
        title: 'Fallback Labor',
        path: '/de/dokumentation/fallback',
        locale: 'de'
      })
    ])
  })

  test('useContentSearchResults delegates CMS searches to the configured endpoint', async () => {
    setRuntimeSearch({
      engine: 'cms',
      apiBaseURL: '/api/_content/search'
    })
    fetchPayload = [{ path: '/docs/fallback', title: 'Fallback Lab', score: 1 }]
    const { useContentSearchResults } = await import('../../packages/content/src/runtime/app/composables/search')

    const result = await useContentSearchResults('fallback', { locale: 'de' })

    expect((fetchCalls[0] as { value: string }).value).toBe('/api/_content/search?q=fallback&locale=de')
    expect(result.pending.value).toBe(false)
    expect(result.error.value).toBe(null)
    expect(result.results.value).toEqual([
      { path: '/docs/fallback', title: 'Fallback Lab', score: 1 }
    ])
  })

  test('useContentSearchResults returns a stable disabled state when public search config is false', async () => {
    setRuntimeSearch(false)
    const { useContentSearchResults } = await import('../../packages/content/src/runtime/app/composables/search')

    const result = await useContentSearchResults('fallback')

    expect(fetchCalls).toEqual([])
    expect(result.results.value).toEqual([])
    expect(result.pending.value).toBe(false)
    expect(result.error.value).toEqual(new Error('Ginko search is disabled. Enable it with `content.search`.'))
  })

  test('useContentSearch exposes headless query, navigation, and selection state', async () => {
    setRuntimeSearch({
      engine: 'minisearch',
      indexURL: '/api/_content/search/index.json'
    })
    fetchPayload = [
      {
        id: '/docs/search',
        path: '/docs/search',
        title: 'Search',
        excerpt: 'Search configuration',
        content: 'MiniSearch setup',
        headings: ['Search'],
        locale: 'en'
      },
      {
        id: '/docs/search-ui',
        path: '/docs/search-ui',
        title: 'Search UI',
        excerpt: 'Custom search interface',
        content: 'Headless search controller',
        headings: ['Interface'],
        locale: 'en'
      }
    ]
    const { useContentSearch } = await import('../../packages/content/src/runtime/app/composables/search')

    const search = await useContentSearch({
      initialQuery: 'search',
      limit: 1
    })

    expect((fetchCalls[0] as { value: string }).value).toBe('/api/_content/search/index.json')
    expect(search.query.value).toBe('search')
    expect(search.results.value).toHaveLength(1)
    expect(search.hasQuery.value).toBe(true)
    expect(search.hasResults.value).toBe(true)
    expect(search.isEmpty.value).toBe(false)
    expect(search.activeResult.value).toBe(null)

    search.next()
    expect(search.activeIndex.value).toBe(0)
    expect(search.activeResult.value).toEqual(expect.objectContaining({
      path: '/docs/search'
    }))
    expect(search.select()).toEqual(expect.objectContaining({
      path: '/docs/search'
    }))

    search.next()
    expect(search.activeIndex.value).toBe(0)
    search.setActiveIndex(Number.NaN)
    expect(search.activeIndex.value).toBe(-1)
    search.setActiveIndex(100)
    expect(search.activeIndex.value).toBe(0)
    search.previous()
    expect(search.activeIndex.value).toBe(-1)

    search.setQuery('missing')
    expect(search.query.value).toBe('missing')
    expect(search.activeIndex.value).toBe(-1)
    expect(search.results.value).toEqual([])
    expect(search.isEmpty.value).toBe(true)

    search.reset()
    expect(search.query.value).toBe('')
    expect(search.activeIndex.value).toBe(-1)
    expect(search.results.value).toEqual([])
  })

  test('useContentSearch preserves disabled-search state without fetching', async () => {
    setRuntimeSearch(false)
    const { useContentSearch } = await import('../../packages/content/src/runtime/app/composables/search')

    const search = await useContentSearch({ initialQuery: 'fallback' })

    expect(fetchCalls).toEqual([])
    expect(search.results.value).toEqual([])
    expect(search.pending.value).toBe(false)
    expect(search.error.value).toEqual(new Error('Ginko search is disabled. Enable it with `content.search`.'))
    expect(search.hasQuery.value).toBe(true)
    expect(search.hasResults.value).toBe(false)
    expect(search.isEmpty.value).toBe(false)
  })
})
