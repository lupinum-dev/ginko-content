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
      experimental: {
        stripQueryParameters: false
      }
    }
  }
}

const route = { path: '/de/guide/advanced', query: {} as Record<string, any> }
const asyncDataCalls: any[] = []
const fetchContentApi = vi.fn(async (kind: string, params: Record<string, any>) => {
  if (kind === 'navigation') {
    return [{
      _id: 'folder:guide',
      title: 'Guide',
      _path: '/guide',
      path: '/de/guide',
      icon: 'book',
      children: [{
        _canonicalKey: 'docs/advanced',
        title: 'Advanced',
        _path: '/guide/advanced',
        path: '/de/guide/advanced',
        badge: 'New'
      }]
    }]
  }

  if (params.resolveVariant) {
    return {
      _path: '/leitfaden/einstieg',
      _resolvedLocale: 'de',
      _variantPaths: {
        en: '/guide/getting-started',
        de: '/leitfaden/einstieg'
      },
      title: 'Einstieg',
      body: {
        type: 'root',
        children: [
          {
            type: 'element',
            tag: 'a',
            props: {
              href: '/leitfaden/einstieg#details'
            },
            children: []
          }
        ]
      }
    }
  }

  if (params.first) {
    return {
      _path: '/guide/advanced',
      title: 'Advanced'
    }
  }

  return [
    {
      _path: '/guide/advanced',
      title: 'Advanced',
      description: 'Deep dive',
      body: {
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
      }
    }
  ]
})

vi.mock('#imports', () => ({
  useNuxtApp: () => ({ $i18n: { locale: undefined } }),
  useState: (_key: string, init?: () => any) => ({ value: init ? init() : undefined }),
  computed: (fn: any) => ({ get value () { return fn() } }),
  ref: (value: any) => ({ value }),
  shallowRef: (value: any) => ({ value }),
  shallowReactive: (value: any) => value,
  toValue: (value: any) => typeof value === 'function' ? value() : value?.value ?? value,
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

vi.mock('../../packages/content/src/runtime/app/composables/async-data', () => ({
  useContentAsyncData: async (key: string, handler: () => Promise<any>, options?: any) => {
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

vi.mock('../../packages/content/src/runtime/app/composables/preview', () => ({
  useContentPreview: () => ({
    getPreviewToken: () => undefined
  })
}))

vi.mock('#build/content-i18n.mjs', () => ({
  useRouteBaseName: () => () => undefined,
  useSetI18nParams: () => () => {},
  useSwitchLocalePath: () => () => ''
}))

vi.mock('../../packages/content/src/runtime/app/composables/content-i18n', () => ({
  useRouteBaseName: () => () => undefined,
  useSetI18nParams: () => () => {},
  useSwitchLocalePath: () => () => ''
}))

vi.mock('../../packages/content/src/runtime/app/composables/utils', () => ({
  fetchContentApi,
  getContentApiFetcher: () => vi.fn(async () => ({ result: [] }))
}))

describe('app query/composable contracts', () => {
  beforeEach(() => {
    asyncDataCalls.length = 0
    fetchContentApi.mockClear()
    route.path = '/de/guide/advanced'
    runtime.public.content.experimental.stripQueryParameters = false
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('client public API exports only the unified query API (ADR-0016) and supported auxiliaries', async () => {
    const client = await import('../../packages/content/src/public/client')

    for (const name of [
      'one',
      'many',
      'paginate',
      'backlinks',
      'resolveOne',
      'variants',
      'tree',
      'neighbors',
      'useContentHead',
      'useContentPage',
      'useContentOne',
      'useContentMany',
      'useContentPagination',
      'useContentBacklinks',
      'useContentResolveOne',
      'useContentVariants',
      'useContentTree',
      'useContentNavigation',
      'useContentNeighbors',
      'useContentSearch',
      'useContentSearchData',
      'useContentSearchResults',
      'querySiteData'
    ]) {
      expect(client).toHaveProperty(name)
      expect(client[name as keyof typeof client]).toBeTypeOf('function')
    }

    for (const staleName of [
      'queryCollection',
      'useContentRoute',
      'useContentSwitchLocalePath'
    ]) {
      expect(client).not.toHaveProperty(staleName)
    }
  })

  test('useContentNavigation wraps tree data with normalized helpers', async () => {
    const { useContentNavigation } = await import('../../packages/content/src/runtime/app/composables/use-content')

    const state = await useContentNavigation('docs', {
      locale: 'de',
      fields: ['icon', 'badge']
    })

    expect(fetchContentApi).toHaveBeenCalledWith('navigation', expect.objectContaining({
      collection: 'docs',
      resolveLocale: expect.objectContaining({ locale: 'de' }),
      only: expect.arrayContaining(['icon', 'badge'])
    }), expect.anything())
    expect(state.data.value).toEqual([
      expect.objectContaining({
        id: 'folder:guide',
        path: '/de/guide',
        title: 'Guide',
        icon: 'book',
        children: [
          expect.objectContaining({
            id: 'docs/advanced',
            path: '/de/guide/advanced',
            title: 'Advanced',
            badge: 'New'
          })
        ]
      })
    ])
    expect(state.firstPage.value).toEqual(expect.objectContaining({
      id: 'folder:guide',
      path: '/de/guide'
    }))
    expect(state.paths.value.has('/de/guide')).toBe(true)
    expect(state.paths.value.has('/de/guide/advanced')).toBe(true)
  })

  test('useContentNavigation keeps pending navigation distinct from an empty provider result', async () => {
    const { useContentNavigation } = await import('../../packages/content/src/runtime/app/composables/use-content')

    const state = await useContentNavigation('docs', {
      locale: 'de',
      fields: ['icon', 'badge']
    })

    expect(asyncDataCalls.at(-1)?.options ?? {}).not.toHaveProperty('default')
    expect(state.pending.value).toBe(false)
    expect(state.data.value).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'folder:guide',
        path: '/de/guide'
      })
    ]))
  })

  test('useContentMany wraps the unified public query API instead of the removed builder', async () => {
    const { useContentMany } = await import('../../packages/content/src/runtime/app/composables/use-content')

    const { data } = await useContentMany('docs', {
      locale: 'de',
      where: { _path: { $prefix: '/guide' } },
      select: ['title']
    })

    expect(data.value).toEqual([
      expect.objectContaining({
        _path: '/guide/advanced',
        title: 'Advanced'
      })
    ])
    expect(fetchContentApi).toHaveBeenCalledWith('query', expect.objectContaining({
      collection: 'docs',
      only: expect.arrayContaining(['title', '_path', '_locale']),
      resolveLocale: expect.objectContaining({
        locale: 'de'
      })
    }), expect.anything())
  })

  test('useContentSearchData exposes explicit search navigation alias', async () => {
    const { useContentSearchData } = await import('../../packages/content/src/runtime/app/composables/search')

    const searchData = await useContentSearchData('docs', { locale: 'de' })

    expect(searchData.searchNavigation).toBe(searchData.navigation)
    expect(searchData.searchNavigation.value).toEqual([
      expect.objectContaining({
        title: 'Guide',
        _path: '/guide',
        path: '/de/guide'
      })
    ])
    expect(searchData.files.value).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: '/de/guide/advanced#deep-dive',
        title: 'Deep dive',
        content: 'Details'
      })
    ]))
    expect(searchData.searchTerm.value).toBe('')
  })

})
