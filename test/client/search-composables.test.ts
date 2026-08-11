import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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

describe('public search composable', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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

  test('useContentSearch loads MiniSearch indexes and filters results by locale', async () => {
    setRuntimeSearch({
      engine: 'minisearch',
      indexURL: '/api/_content/search/index.json'
    })
    fetchPayload = [
      {
        id: '/docs/fallback#overview',
        collection: 'docs',
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
        collection: 'docs',
        path: '/de/dokumentation/fallback',
        title: 'Fallback Labor',
        excerpt: 'Fallback Verhalten',
        content: 'Fallback Routen',
        headings: ['Ueberblick'],
        anchor: 'ueberblick',
        locale: 'de'
      }
    ]
    const { useContentSearch } = await import('../../packages/content/src/runtime/app/composables/search')

    const search = await useContentSearch({ initialQuery: 'fallback', locale: 'de' })

    expect((fetchCalls[0] as { value: string }).value).toBe('/api/_content/search/index.json?locale=de')
    expect(search.pending.value).toBe(false)
    expect(search.error.value).toBe(null)
    expect(search.results.value).toEqual([
      expect.objectContaining({
        title: 'Fallback Labor',
        collection: 'docs',
        path: '/de/dokumentation/fallback',
        locale: 'de'
      })
    ])
    // Collection-scoped search sections/navigation are opt-in; omitting
    // `collection` keeps them empty with no extra request.
    expect(search.files.value).toEqual([])
    expect(search.searchNavigation.value).toEqual([])
  })

  test('useContentSearch delegates CMS searches to the configured endpoint', async () => {
    setRuntimeSearch({
      engine: 'provider',
      apiBaseURL: '/api/_content/search'
    })
    fetchPayload = [{ collection: 'docs', path: '/docs/fallback', title: 'Fallback Lab', score: 1 }]
    const { useContentSearch } = await import('../../packages/content/src/runtime/app/composables/search')

    const search = await useContentSearch({ initialQuery: 'fallback', locale: 'de' })

    expect(fetchCalls[0]).toBe('/api/_content/search?q=fallback&locale=de')
    expect(search.pending.value).toBe(false)
    expect(search.error.value).toBe(null)
    expect(search.results.value).toEqual([
      { collection: 'docs', path: '/docs/fallback', title: 'Fallback Lab', score: 1 }
    ])
  })

  test('useContentSearch keeps empty provider searches local', async () => {
    setRuntimeSearch({
      engine: 'provider',
      apiBaseURL: '/api/_content/search'
    })
    const { useContentSearch } = await import('../../packages/content/src/runtime/app/composables/search')

    const search = await useContentSearch({ initialQuery: '   ', locale: 'de' })

    expect(fetchCalls).toEqual([])
    expect(search.pending.value).toBe(false)
    expect(search.error.value).toBe(null)
    expect(search.results.value).toEqual([])
  })

  test('useContentSearch returns a stable disabled state when public search config is false', async () => {
    setRuntimeSearch(false)
    const { useContentSearch } = await import('../../packages/content/src/runtime/app/composables/search')

    const search = await useContentSearch({ initialQuery: 'fallback' })

    expect(fetchCalls).toEqual([])
    expect(search.results.value).toEqual([])
    expect(search.pending.value).toBe(false)
    expect(search.error.value).toEqual(new Error('Ginko search is disabled. Enable it with `content.search`.'))
  })

  test('useContentSearch exposes headless query, navigation, and selection state', async () => {
    setRuntimeSearch({
      engine: 'minisearch',
      indexURL: '/api/_content/search/index.json'
    })
    fetchPayload = [
      {
        id: '/docs/search',
        collection: 'docs',
        path: '/docs/search',
        title: 'Search',
        excerpt: 'Search configuration',
        content: 'MiniSearch setup',
        headings: ['Search'],
        locale: 'en'
      },
      {
        id: '/docs/search-ui',
        collection: 'docs',
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
      path: '/docs/search',
      collection: 'docs'
    }))
    expect(search.select()).toEqual(expect.objectContaining({
      path: '/docs/search',
      collection: 'docs'
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

  test('useContentSearch keeps Pagefind inert during server rendering', async () => {
    setRuntimeSearch({ engine: 'pagefind' })
    const nativeFetch = vi.spyOn(globalThis, 'fetch')
    const { useContentSearch } = await import('../../packages/content/src/runtime/app/composables/search')

    const search = await useContentSearch({ initialQuery: 'guide', locale: 'en' })

    expect(nativeFetch).not.toHaveBeenCalled()
    expect(search.results.value).toEqual([])
    expect(search.pending.value).toBe(false)
    expect(search.error.value).toBe(null)
  })
})
