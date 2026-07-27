import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const runtime = {
  public: {
    content: {
      api: { baseURL: '/api/_content' },
      collections: {
        docs: {
          i18n: {
            defaultLocale: 'en',
            locales: ['en', 'de']
          }
        }
      },
      defaultLocale: 'en',
      locales: ['en', 'de'],
      localeFallback: { de: ['en'] },
      integrity: 'abc123',
      // Disabled here so `useContentSearch` tests exercise only the
      // collection-scoped `files`/`searchNavigation` loading, not the query-driven minisearch/pagefind/provider backend
      // (already covered end-to-end in test/client/search-composables.test.ts).
      search: false
    }
  }
}

const route = { path: '/de/guide/advanced', query: {} as Record<string, any> }
const asyncDataCalls: any[] = []
const addPrerenderPath = vi.fn()
const createPrerenderPathAdder = vi.fn(() => addPrerenderPath)
const publicDocument = (path: string, title: string, body?: Record<string, unknown>) => ({
  id: `content:de:${path.replace(/^\//, '').replace(/\//g, ':')}.md`,
  collection: 'docs',
  canonicalKey: `docs:${path.replace(/^\/(?:de\/)?/, '')}`,
  locale: 'de',
  title,
  ...(body ? { body } : {}),
  route: { resolvedPath: path, alternates: [] },
  resolution: { requested: { locale: 'de' }, resolved: { locale: 'de' }, usedFallback: false }
})
const fetchContentApi = vi.fn(async (kind: string, params: Record<string, any>) => {
  if (kind === 'navigation') {
    return [{
      id: 'folder:guide',
      title: 'Guide',
      path: '/de/guide',
      icon: 'book',
      children: [{
        canonicalKey: 'docs/advanced',
        title: 'Advanced',
        path: '/de/guide/advanced',
        badge: 'New'
      }]
    }]
  }

  if (params.resolveVariant) {
    return {
      result: publicDocument('/de/leitfaden/einstieg', 'Einstieg', {
        type: 'root',
        children: [{
          type: 'element',
          tag: 'a',
          props: { href: '/leitfaden/einstieg#details' },
          children: []
        }]
      })
    }
  }

  if (params.first) {
    return { result: publicDocument('/de/guide/advanced', 'Advanced') }
  }

  return {
    result: [publicDocument('/de/guide/advanced', 'Advanced', {
      type: 'root',
      children: [
        {
          type: 'element',
          tag: 'h2',
          props: { id: 'deep-dive' },
          children: [{ type: 'text', value: 'Deep dive' }]
        },
        {
          type: 'element',
          tag: 'p',
          props: {},
          children: [{ type: 'text', value: 'Details' }]
        }
      ]
    })],
    skip: params.skip ?? 0,
    limit: params.limit ?? 100,
    total: 1
  }
})

vi.mock('#imports', () => ({
  useNuxtApp: () => ({ $i18n: { locale: undefined } }),
  useRoute: () => route,
  useRuntimeConfig: () => runtime.public,
  useState: (_key: string, init?: () => any) => ({ value: init ? init() : undefined }),
  computed: (fn: any) => ({ get value () { return fn() } }),
  ref: (value: any) => ({ value }),
  shallowRef: (value: any) => ({ value }),
  shallowReactive: (value: any) => value,
  toValue: (value: any) => typeof value === 'function' ? value() : value?.value ?? value,
  watchEffect: (effect: (onCleanup: (fn: () => void) => void) => void) => effect(() => {}),
  useRequestFetch: () => vi.fn(async () => ({ result: [] })),
  useAsyncData: async (key: string, handler: () => Promise<any>, options?: any) => {
    const result = await handler()
    asyncDataCalls.push({ key, options, result })
    return {
      data: { value: result },
      error: { value: null },
      pending: { value: false },
      status: { value: 'success' },
      refresh: vi.fn(async () => {})
    }
  }
}))

vi.mock('../../packages/content/src/runtime/app/composables/runtime', () => ({
  getContentRuntime: () => runtime.public.content,
  getContentRoute: () => route
}))

vi.mock('../../packages/content/src/runtime/app/composables/locale-context', () => ({
  getLocaleContext: () => ({
    route,
    nuxtApp: { $i18n: { locale: undefined } },
    resolvedLocaleState: { value: undefined }
  })
}))

vi.mock('../../packages/content/src/runtime/app/composables/preview', () => ({
  useContentPreview: () => ({
    getPreviewToken: () => undefined
  })
}))

vi.mock('../../packages/content/src/runtime/app/composables/utils', () => ({
  createPrerenderPathAdder,
  fetchContentApi,
  getContentApiFetcher: () => vi.fn(async () => ({ result: [] })),
  getPreviewToken: () => 'captured-preview-token'
}))

describe('app query/composable contracts', () => {
  beforeEach(() => {
    asyncDataCalls.length = 0
    fetchContentApi.mockClear()
    addPrerenderPath.mockClear()
    createPrerenderPathAdder.mockClear()
    route.path = '/de/guide/advanced'
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('client public API exports exactly useContentPage/useContentSearch plus the unified query API', async () => {
    const client = await import('../../packages/content/src/public/client')

    for (const name of [
      'one',
      'many',
      'paginate',
      'backlinks',
      'resolveOne',
      'surround',
      'navigation',
      'getCollectionPath',
      'useContentPage',
      'useContentSearch',
      'querySiteData',
      'extractContentToc'
    ]) {
      expect(client).toHaveProperty(name)
      expect(client[name as keyof typeof client]).toBeTypeOf('function')
    }

    for (const staleName of [
      'queryCollection',
      'useContentRoute',
      'useContentSwitchLocalePath',
      'useContentHead',
      'useContentOne',
      'useContentMany',
      'useContentPagination',
      'useContentBacklinks',
      'useContentResolveOne',
      'useContentVariants',
      'useContentTree',
      'useContentNavigation',
      'useContentNeighbors',
      'useContentToc',
      'useContentSearchData',
      'useContentSearchResults'
    ]) {
      expect(client).not.toHaveProperty(staleName)
    }
  })

  test('many() from /client returns the canonical route/resolution envelope, not the legacy flat shape', async () => {
    const { many } = await import('../../packages/content/src/runtime/app/composables/query-api')

    const items = await many('docs', {
      locale: 'de',
      where: { path: { $prefix: '/guide' } },
      select: ['title']
    })

    expect(items).toEqual([
      expect.objectContaining({
        title: 'Advanced',
        route: expect.objectContaining({ resolvedPath: expect.any(String) }),
        resolution: expect.objectContaining({ resolved: expect.objectContaining({ locale: expect.any(String) }) })
      })
    ])
    expect(items[0]).not.toHaveProperty('unprefixedPath')
    expect(items[0]).not.toHaveProperty('localePaths')
    expect(items[0]).not.toHaveProperty('variants')
    expect(fetchContentApi).toHaveBeenCalledWith(
      'query',
      expect.objectContaining({
        collection: 'docs',
        only: expect.arrayContaining(['title', 'path', 'locale']),
        resolveLocale: expect.objectContaining({
          locale: 'de'
        })
      }),
      expect.objectContaining({ previewToken: 'captured-preview-token' })
    )
  })

  test('captures one request-bound prerender writer for both phases of surround()', async () => {
    const { surround } = await import('../../packages/content/src/runtime/app/composables/query-api')

    await surround('docs', {
      by: { route: '/de/guide/advanced' },
      locale: 'de',
      fallback: true
    })

    expect(createPrerenderPathAdder).toHaveBeenCalledOnce()
    expect(fetchContentApi).toHaveBeenCalledTimes(2)
    expect(fetchContentApi.mock.calls.map(call => call[0])).toEqual(['query', 'navigation'])
    expect(fetchContentApi.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ addPrerenderPath }))
    expect(fetchContentApi.mock.calls[1]?.[2]).toEqual(expect.objectContaining({ addPrerenderPath }))
  })

  test('client queries reject malformed public options before transport', async () => {
    const { many, one } = await import('../../packages/content/src/runtime/app/composables/query-api')

    await expect(one('docs', { by: {} } as never)).rejects.toThrow(/Invalid content query selector/)
    await expect(many('docs', { where: { $or: [] } } as never)).rejects.toThrow(/logical groups cannot be empty/)
    await expect(many('docs', { limit: 101 } as never)).rejects.toThrow(/limit exceeds the maximum/)

    expect(fetchContentApi).not.toHaveBeenCalled()
  })

  test('useContentSearch({ collection }) loads search sections and navigation', async () => {
    const { useContentSearch } = await import('../../packages/content/src/runtime/app/composables/search')

    const search = await useContentSearch({ collection: 'docs', locale: 'de' })

    expect(search.searchNavigation.value).toEqual([
      expect.objectContaining({
        title: 'Guide',
        path: '/de/guide'
      })
    ])
    expect(search.files.value).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: '/de/guide/advanced#deep-dive',
        title: 'Deep dive',
        content: 'Details'
      })
    ]))
  })

  test('useContentSearch omits files/searchNavigation and skips the extra request without a collection', async () => {
    const { useContentSearch } = await import('../../packages/content/src/runtime/app/composables/search')

    fetchContentApi.mockClear()
    const search = await useContentSearch({})

    expect(search.files.value).toEqual([])
    expect(search.searchNavigation.value).toEqual([])
    expect(fetchContentApi).not.toHaveBeenCalledWith('navigation', expect.anything(), expect.anything())
  })
})
