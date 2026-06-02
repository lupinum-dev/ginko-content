import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createEvent } from './_utils'

const externalProviderModules = vi.hoisted(() => new Map<string, unknown>())

const runtime = {
  public: {
    siteUrl: 'https://example.test',
    i18n: {
      locales: [
        { code: 'en', language: 'en-US' },
        { code: 'de', language: 'de-DE' }
      ]
    },
    content: {
      provider: 'mock-cms',
      api: { baseURL: '/api/_content' },
      navigation: { fields: [] },
      sitemap: { path: '/sitemap' },
      defaultLocale: 'en',
      locales: ['en', 'de'],
      localeFallback: { de: ['en'] },
      translatedSlugs: true,
      collections: {}
    }
  },
  content: {
    provider: 'mock-cms',
    navigation: { fields: [] },
    sitemap: { path: '/sitemap' },
    defaultLocale: 'en',
    locales: ['en', 'de'],
    localeFallback: { de: ['en'] },
    translatedSlugs: true,
    collections: {
      landing: { source: 'index.yml', strict: true, i18n: { defaultLocale: 'en', locales: ['en', 'de'] } },
      docs: { source: 'docs/**/*.md', strict: true, i18n: { defaultLocale: 'en', locales: ['en', 'de'] } },
      posts: { source: 'blog/**/*.md', strict: true, i18n: { defaultLocale: 'en', locales: ['en', 'de'] } },
      versions: { source: 'changelog/**/*.md', strict: true, sitemap: false, i18n: { defaultLocale: 'en', locales: ['en', 'de'] } }
    }
  }
}

vi.mock('#imports', () => ({
  useRuntimeConfig: () => runtime
}))

vi.mock('#content/virtual/providers', () => ({
  externalContentProviderNames: [...externalProviderModules.keys()],
  loadExternalContentProvider: (name: string) => {
    if (name === 'broken-external') {
      throw new Error('provider module failed to load')
    }
    return externalProviderModules.get(name)
  }
}))

describe('content provider contract', () => {
  const createProviderEvent = () => ({
    ...createEvent(),
    context: {
      contentRuntime: runtime.content
    }
  }) as any

  beforeEach(() => {
    runtime.public.content.collections = runtime.content.collections
    runtime.content.provider = 'mock-cms'
    runtime.public.content.provider = 'mock-cms'
    externalProviderModules.clear()
  })

  test('filesystem provider declares the same provider contract metadata', async () => {
    const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')

    expect(filesystemProvider.name).toBe('filesystem')
    expect(filesystemProvider.capabilities).toMatchObject({
      routeBackedCollections: true,
      dataCollections: true,
      localizedRoutes: true,
      translatedSlugs: true,
      navigation: true,
      surroundings: true,
      searchSections: true,
      sitemap: true,
      query: {
        limit: true,
        skip: true,
        count: true
      }
    })
    expect(filesystemProvider.capabilities.query.operators).toContain('$eq')
    expect(filesystemProvider.capabilities.query.operators).toContain('$contains')
    expect(filesystemProvider.capabilities.query.operators).toContain('$prefix')
  })

  test('runtime provider resolver uses one event-aware selection path', async () => {
    const { getContentProvider } = await import('../../packages/content/src/runtime/server/providers')

    runtime.content.provider = 'mock-cms'
    await expect(getContentProvider(createProviderEvent())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'unknown_provider',
      data: expect.objectContaining({
        code: 'unknown_provider',
        provider: 'mock-cms'
      })
    })

    runtime.content.provider = 'custom-prototype'
    await expect(getContentProvider(createProviderEvent())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'unknown_provider',
      data: expect.objectContaining({
        code: 'unknown_provider',
        provider: 'custom-prototype'
      })
    })

    runtime.content.provider = 'filesystem'
    await expect(getContentProvider(createProviderEvent())).resolves.toMatchObject({ name: 'filesystem' })

    externalProviderModules.set('custom-provider', {
      name: 'custom-provider',
      capabilities: {
        routeBackedCollections: true,
        dataCollections: true,
        localizedRoutes: true,
        translatedSlugs: true,
        navigation: true,
        surroundings: true,
        searchSections: true,
        sitemap: true,
        query: {
          operators: ['$eq'],
          limit: true,
          skip: false,
          count: false
        }
      },
      query: vi.fn(),
      navigationQuery: vi.fn(),
      navigation: vi.fn(),
      surroundings: vi.fn(),
      searchSections: vi.fn(),
      search: vi.fn(),
      siteData: vi.fn(),
      page: vi.fn(),
      routeMeta: vi.fn(),
      sitemapEntries: vi.fn()
    })
    runtime.content.provider = 'custom-provider'
    await expect(getContentProvider(createProviderEvent())).resolves.toMatchObject({ name: 'custom-provider' })

    externalProviderModules.set('malformed-external', {
      name: 'malformed-external',
      capabilities: { query: {} }
    })
    runtime.content.provider = 'malformed-external' as never
    await expect(getContentProvider(createProviderEvent())).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'provider_module_invalid',
      data: expect.objectContaining({
        code: 'provider_module_invalid',
        provider: 'malformed-external',
        field: 'capabilities.routeBackedCollections'
      })
    })

    externalProviderModules.set('invalid-capabilities-external', {
      name: 'invalid-capabilities-external',
      capabilities: {
        routeBackedCollections: true,
        dataCollections: true,
        localizedRoutes: true,
        translatedSlugs: true,
        navigation: true,
        surroundings: true,
        searchSections: true,
        sitemap: true,
        query: {
          operators: '$eq',
          sort: 'sometimes',
          limit: true,
          skip: false,
          count: false
        }
      },
      query: vi.fn(),
      navigationQuery: vi.fn(),
      navigation: vi.fn(),
      surroundings: vi.fn(),
      searchSections: vi.fn(),
      page: vi.fn(),
      routeMeta: vi.fn(),
      sitemapEntries: vi.fn()
    })
    runtime.content.provider = 'invalid-capabilities-external' as never
    await expect(getContentProvider(createProviderEvent())).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'provider_module_invalid',
      data: expect.objectContaining({
        code: 'provider_module_invalid',
        provider: 'invalid-capabilities-external',
        field: 'capabilities.query.operators'
      })
    })

    runtime.content.provider = 'broken-external' as never
    await expect(getContentProvider(createProviderEvent())).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'provider_module_missing',
      data: expect.objectContaining({
        code: 'provider_module_missing',
        provider: 'broken-external'
      })
    })

    runtime.content.provider = 'missing' as never
    await expect(getContentProvider(createProviderEvent())).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'unknown_provider',
      data: expect.objectContaining({
        code: 'unknown_provider',
        provider: 'missing'
      })
    })

    runtime.content.provider = 'mock-cms'
  })

  test('provider query capabilities are enforced before provider query execution', async () => {
    const { getContentProvider } = await import('../../packages/content/src/runtime/server/providers')
    const query = vi.fn(async () => [])

    externalProviderModules.set('limited-query', {
      name: 'limited-query',
      capabilities: {
        routeBackedCollections: true,
        dataCollections: true,
        localizedRoutes: true,
        translatedSlugs: true,
        navigation: true,
        surroundings: true,
        searchSections: true,
        sitemap: true,
        query: {
          operators: ['$eq'],
          limit: true,
          skip: false,
          count: false
        }
      },
      query,
      navigationQuery: vi.fn(),
      navigation: vi.fn(),
      surroundings: vi.fn(),
      searchSections: vi.fn(),
      page: vi.fn(),
      routeMeta: vi.fn(),
      sitemapEntries: vi.fn()
    })

    runtime.content.provider = 'limited-query'
    const provider = await getContentProvider(createProviderEvent())

    await expect(provider.query(createProviderEvent(), {
      collection: 'posts',
      where: { title: { $contains: 'hello' } }
    })).rejects.toMatchObject({
      statusMessage: 'unsupported_query_operator',
      data: expect.objectContaining({
        provider: 'limited-query',
        operator: '$contains'
      })
    })

    await expect(provider.query(createProviderEvent(), {
      collection: 'posts',
      skip: 10
    })).rejects.toMatchObject({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({
        provider: 'limited-query',
        field: 'skip'
      })
    })

    await expect(provider.query(createProviderEvent(), {
      collection: 'posts',
      count: true
    })).rejects.toMatchObject({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({
        provider: 'limited-query',
        field: 'count'
      })
    })

    expect(query).not.toHaveBeenCalled()

    await expect(provider.query(createProviderEvent(), {
      collection: 'posts',
      where: { title: { $eq: 'hello' } },
      sort: [{ date: -1 }],
      only: ['title', 'date'],
      without: ['body'],
      limit: 1
    })).resolves.toEqual([])
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      collection: 'posts',
      where: { title: { $eq: 'hello' } },
      sort: [{ date: -1 }],
      only: ['title', 'date'],
      without: ['body'],
      limit: 1
    }))
  })

  test('provider operation capabilities are enforced even when unsupported methods exist', async () => {
    const { getContentProvider } = await import('../../packages/content/src/runtime/server/providers')
    const navigationQuery = vi.fn(async () => [])
    const sitemapEntries = vi.fn(async () => [])
    const page = vi.fn(async () => null)

    externalProviderModules.set('method-only-provider', {
      name: 'method-only-provider',
      capabilities: {
        routeBackedCollections: false,
        dataCollections: true,
        localizedRoutes: false,
        translatedSlugs: false,
        navigation: false,
        surroundings: false,
        searchSections: false,
        sitemap: false,
        query: {
          operators: ['$eq'],
          limit: true,
          skip: true,
          count: true
        }
      },
      query: vi.fn(async () => ({ result: [] })),
      navigationQuery,
      sitemapEntries,
      page
    })

    runtime.content.provider = 'method-only-provider'
    const provider = await getContentProvider(createProviderEvent())

    await expect(provider.navigationQuery?.(createProviderEvent(), {})).rejects.toMatchObject({
      statusMessage: 'unsupported_provider_operation',
      data: expect.objectContaining({
        provider: 'method-only-provider',
        operation: 'navigation'
      })
    })
    await expect(provider.sitemapEntries?.(createProviderEvent(), {})).rejects.toMatchObject({
      statusMessage: 'unsupported_provider_operation',
      data: expect.objectContaining({
        provider: 'method-only-provider',
        operation: 'sitemap entries'
      })
    })
    await expect(provider.page?.(createProviderEvent(), 'docs', '/')).rejects.toMatchObject({
      statusMessage: 'unsupported_provider_operation',
      data: expect.objectContaining({
        provider: 'method-only-provider',
        operation: 'route-backed pages'
      })
    })

    expect(navigationQuery).not.toHaveBeenCalled()
    expect(sitemapEntries).not.toHaveBeenCalled()
    expect(page).not.toHaveBeenCalled()
  })

  test('CMS-like providers can support public reads without filesystem search sections', async () => {
    const { getContentProvider } = await import('../../packages/content/src/runtime/server/providers')
    const query = vi.fn(async () => ({ result: [{ title: 'CMS page' }] }))
    const cmsNavigation = [
      {
        title: 'Einfuehrung',
        _path: '/dokumentation/einstieg',
        path: '/de/dokumentation/einstieg',
        _canonicalKey: 'docs/getting-started',
        _locale: 'de',
        stableId: 'docs-getting-started',
        ref: 'docs-getting-started',
        children: [
          {
            title: 'Installation',
            _path: '/dokumentation/einstieg/installation',
            path: '/de/dokumentation/einstieg/installation',
            _canonicalKey: 'docs/getting-started/installation',
            _locale: 'de',
            stableId: 'docs-installation',
            ref: 'docs-installation'
          }
        ]
      },
      {
        title: 'Grundlagen',
        _canonicalKey: 'docs/essentials',
        _locale: 'de',
        children: [
          {
            title: 'Fallback Lab',
            _path: '/docs/essentials/fallback-lab',
            path: '/de/docs/essentials/fallback-lab',
            _canonicalKey: 'docs/essentials/fallback-lab',
            _locale: 'en',
            _fallback: true,
            stableId: 'docs-fallback-lab',
            ref: 'docs-fallback-lab'
          }
        ]
      }
    ]
    const navigationQuery = vi.fn(async () => cmsNavigation)
    const navigation = vi.fn(async () => cmsNavigation)
    const surroundings = vi.fn(async () => [null, { _path: '/docs/next' }])
    const search = vi.fn(async () => [{ id: 'cms-hit', title: 'CMS hit' }])
    const searchSections = vi.fn(async () => [])
    const siteData = vi.fn(async () => ({ title: 'CMS site' }))
    const page = vi.fn(async () => ({ _path: '/docs', title: 'CMS page' }))
    const routeMeta = vi.fn(async () => ({ path: '/docs', locale: 'en' }))
    const sitemapEntries = vi.fn(async () => [{ loc: 'https://example.test/docs' }])

    externalProviderModules.set('cms-like', {
      name: 'cms-like',
      capabilities: {
        routeBackedCollections: true,
        dataCollections: true,
        localizedRoutes: true,
        translatedSlugs: true,
        navigation: true,
        surroundings: true,
        searchSections: false,
        sitemap: true,
        query: {
          operators: ['$eq'],
          limit: true,
          skip: false,
          count: false
        }
      },
      query,
      navigationQuery,
      navigation,
      surroundings,
      search,
      searchSections,
      siteData,
      page,
      routeMeta,
      sitemapEntries
    })

    runtime.content.provider = 'cms-like'
    const provider = await getContentProvider(createProviderEvent())
    const event = createProviderEvent()

    await expect(provider.page?.(event, 'docs', '/docs')).resolves.toMatchObject({
      title: 'CMS page'
    })
    await expect(provider.query(event, {
      collection: 'docs',
      where: { _path: { $eq: '/docs' } },
      limit: 1
    })).resolves.toMatchObject({
      result: [{ title: 'CMS page' }]
    })
    await expect(provider.navigation?.(event, 'docs')).resolves.toEqual(cmsNavigation)
    await expect(provider.navigationQuery?.(event, { collection: 'docs' })).resolves.toEqual([
      ...cmsNavigation
    ])
    await expect(provider.surroundings?.(event, 'docs', '/docs')).resolves.toEqual([
      null,
      { _path: '/docs/next' }
    ])
    await expect(provider.search?.(event, { query: 'cms' })).resolves.toEqual([
      { id: 'cms-hit', title: 'CMS hit' }
    ])
    await expect(provider.siteData?.(event, { key: 'settings', locale: 'en' })).resolves.toEqual({
      title: 'CMS site'
    })
    await expect(provider.routeMeta?.(event, 'docs', '/docs')).resolves.toEqual({
      path: '/docs',
      locale: 'en'
    })
    await expect(provider.sitemapEntries?.(event, { include: ['docs'] })).resolves.toEqual([
      { loc: 'https://example.test/docs' }
    ])

    await expect(provider.searchSections?.(event, 'docs')).rejects.toMatchObject({
      statusMessage: 'unsupported_provider_operation',
      data: expect.objectContaining({
        provider: 'cms-like',
        operation: 'search sections'
      })
    })
    await expect(provider.query(event, {
      collection: 'docs',
      skip: 1
    })).rejects.toMatchObject({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({
        provider: 'cms-like',
        field: 'skip'
      })
    })

    expect(query).toHaveBeenCalledTimes(1)
    expect(searchSections).not.toHaveBeenCalled()
  })

})
