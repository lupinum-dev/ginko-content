import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createEvent } from './_utils'
import { toContentProviderNavigationQuery, toContentProviderQuery } from '../../packages/content/src/public/provider-query'

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
        pagination: ['offset', 'cursor']
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
          pagination: []
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
          pagination: []
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

    externalProviderModules.set('missing-sitemap-method', {
      name: 'missing-sitemap-method',
      capabilities: {
        routeBackedCollections: true,
        dataCollections: true,
        localizedRoutes: true,
        translatedSlugs: true,
        navigation: false,
        surroundings: false,
        searchSections: false,
        sitemap: true,
        query: {
          operators: ['$eq'],
          pagination: ['offset']
        }
      },
      query: vi.fn(),
      page: vi.fn(),
      routeMeta: vi.fn()
    })
    runtime.content.provider = 'missing-sitemap-method' as never
    await expect(getContentProvider(createProviderEvent())).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'provider_module_invalid',
      data: expect.objectContaining({
        code: 'provider_module_invalid',
        provider: 'missing-sitemap-method',
        field: 'sitemapEntries'
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
          pagination: []
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

    await expect(provider.query(createProviderEvent(), toContentProviderQuery({
      collection: 'posts',
      where: { title: { $contains: 'hello' } }
    }))).rejects.toMatchObject({
      statusMessage: 'unsupported_query_operator',
      data: expect.objectContaining({
        provider: 'limited-query',
        operator: '$contains'
      })
    })

    await expect(provider.query(createProviderEvent(), toContentProviderQuery({
      collection: 'posts',
      skip: 10
    }))).rejects.toMatchObject({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({
        provider: 'limited-query',
        field: 'skip'
      })
    })

    await expect(provider.query(createProviderEvent(), toContentProviderQuery({
      collection: 'posts',
      count: true
    }))).rejects.toMatchObject({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({
        provider: 'limited-query',
        field: 'count'
      })
    })

    expect(query).not.toHaveBeenCalled()

    await expect(provider.query(createProviderEvent(), toContentProviderQuery({
      collection: 'posts',
      where: { title: { $eq: 'hello' } },
      sort: [{ date: -1 }],
      only: ['title', 'date'],
      without: ['body'],
      limit: 1
    }))).resolves.toEqual([])
    expect(query).toHaveBeenCalledTimes(1)
    expect(query).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      v: 2,
      collection: 'posts',
      plan: expect.objectContaining({
        collection: 'posts',
        filter: { type: 'compare', field: 'title', operator: 'eq', value: 'hello' },
        sort: [{ field: 'date', direction: -1 }],
        projection: { only: ['title', 'date'], without: ['body'] },
        limit: 1
      })
    }))
  })

  test('provider query version is enforced before provider query execution', async () => {
    const { getContentProvider } = await import('../../packages/content/src/runtime/server/providers')
    const query = vi.fn(async () => [])

    externalProviderModules.set('versioned-query', {
      name: 'versioned-query',
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
          pagination: ['offset']
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

    runtime.content.provider = 'versioned-query'
    const provider = await getContentProvider(createProviderEvent())
    const badQuery = {
      ...toContentProviderQuery({ collection: 'posts' }),
      v: 99
    } as any

    await expect(provider.query(createProviderEvent(), badQuery)).rejects.toMatchObject({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({
        provider: 'versioned-query',
        field: 'v'
      })
    })
    expect(query).not.toHaveBeenCalled()
  })

  test('provider navigationQuery capabilities are enforced before provider execution', async () => {
    const { getContentProvider } = await import('../../packages/content/src/runtime/server/providers')
    const navigationQuery = vi.fn(async () => [])

    externalProviderModules.set('limited-navigation-query', {
      name: 'limited-navigation-query',
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
          pagination: []
        }
      },
      query: vi.fn(async () => []),
      navigationQuery,
      navigation: vi.fn(),
      surroundings: vi.fn(),
      searchSections: vi.fn(),
      page: vi.fn(),
      routeMeta: vi.fn(),
      sitemapEntries: vi.fn()
    })

    runtime.content.provider = 'limited-navigation-query'
    const provider = await getContentProvider(createProviderEvent())

    await expect(provider.navigationQuery?.(createProviderEvent(), toContentProviderNavigationQuery({
      collection: 'posts',
      where: { title: { $contains: 'hello' } }
    }).query)).rejects.toMatchObject({
      statusMessage: 'unsupported_query_operator',
      data: expect.objectContaining({
        provider: 'limited-navigation-query',
        operator: '$contains'
      })
    })

    // `limit` alone needs no pagination-mode capability (VNEXT.md 13.1) — a
    // plain bounded navigation query is valid for any provider. `skip` DOES
    // require the `offset` mode this provider does not advertise.
    await expect(provider.navigationQuery?.(createProviderEvent(), toContentProviderNavigationQuery({
      collection: 'posts',
      skip: 5
    }).query)).rejects.toMatchObject({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({
        provider: 'limited-navigation-query',
        field: 'skip'
      })
    })

    await expect(provider.navigationQuery?.(createProviderEvent(), {
      ...toContentProviderNavigationQuery({ collection: 'posts' }).query,
      v: 99
    } as any)).rejects.toMatchObject({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({
        provider: 'limited-navigation-query',
        field: 'v'
      })
    })

    expect(navigationQuery).not.toHaveBeenCalled()

    const wire = toContentProviderNavigationQuery({
      collection: 'posts',
      where: { title: { $eq: 'hello' } }
    })
    await expect(provider.navigationQuery?.(createProviderEvent(), wire.query, wire.options)).resolves.toEqual([])
    expect(navigationQuery).toHaveBeenCalledTimes(1)
    expect(navigationQuery).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      v: 2,
      collection: 'posts',
      plan: expect.objectContaining({
        filter: { type: 'compare', field: 'title', operator: 'eq', value: 'hello' }
      })
    }), wire.options)
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
          pagination: ['offset']
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
        path: '/de/dokumentation/einstieg',
        canonicalKey: 'docs/getting-started',
        locale: 'de',
        stableId: 'docs-getting-started',
        ref: 'docs-getting-started',
        children: [
          {
            title: 'Installation',
            path: '/de/dokumentation/einstieg/installation',
            canonicalKey: 'docs/getting-started/installation',
            locale: 'de',
            stableId: 'docs-installation',
            ref: 'docs-installation'
          }
        ]
      },
      {
        title: 'Grundlagen',
        canonicalKey: 'docs/essentials',
        locale: 'de',
        children: [
          {
            title: 'Fallback Lab',
            path: '/de/docs/essentials/fallback-lab',
            canonicalKey: 'docs/essentials/fallback-lab',
            locale: 'en',
            _fallback: true,
            stableId: 'docs-fallback-lab',
            ref: 'docs-fallback-lab'
          }
        ]
      }
    ]
    const navigationQuery = vi.fn(async () => cmsNavigation)
    const navigation = vi.fn(async () => cmsNavigation)
    const surroundings = vi.fn(async () => [null, { path: '/docs/next' }])
    const search = vi.fn(async () => [{ id: 'cms-hit', title: 'CMS hit' }])
    const searchSections = vi.fn(async () => [])
    const siteData = vi.fn(async () => ({ title: 'CMS site' }))
    const page = vi.fn(async () => ({ path: '/docs', title: 'CMS page' }))
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
          pagination: []
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
    await expect(provider.query(event, toContentProviderQuery({
      collection: 'docs',
      where: { path: { $eq: '/docs' } },
      limit: 1
    }))).resolves.toMatchObject({
      result: [{ title: 'CMS page' }]
    })
    await expect(provider.navigation?.(event, 'docs')).resolves.toEqual(cmsNavigation)
    const cmsNavWire = toContentProviderNavigationQuery({ collection: 'docs' })
    await expect(provider.navigationQuery?.(event, cmsNavWire.query, cmsNavWire.options)).resolves.toEqual([
      ...cmsNavigation
    ])
    await expect(provider.surroundings?.(event, 'docs', '/docs')).resolves.toEqual([
      null,
      { path: '/docs/next' }
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
    await expect(provider.query(event, toContentProviderQuery({
      collection: 'docs',
      skip: 1
    }))).rejects.toMatchObject({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({
        provider: 'cms-like',
        field: 'skip'
      })
    })

    expect(query).toHaveBeenCalledTimes(1)
    expect(searchSections).not.toHaveBeenCalled()
  })

  test('provider sitemap boundary rejects malformed sitemap entries', async () => {
    const { queryCollectionsSitemapEntries } = await import('../../packages/content/src/runtime/server/sitemap-provider')

    externalProviderModules.set('malformed-sitemap-provider', {
      name: 'malformed-sitemap-provider',
      capabilities: {
        routeBackedCollections: true,
        dataCollections: true,
        localizedRoutes: true,
        translatedSlugs: true,
        navigation: false,
        surroundings: false,
        searchSections: false,
        sitemap: true,
        query: {
          operators: ['$eq'],
          pagination: ['offset']
        }
      },
      query: vi.fn(async () => ({ result: [] })),
      page: vi.fn(),
      routeMeta: vi.fn(),
      sitemapEntries: vi.fn(async () => [
        { loc: '/docs/valid' },
        { path: '/docs/missing-loc' }
      ])
    })

    runtime.content.provider = 'malformed-sitemap-provider'

    await expect(queryCollectionsSitemapEntries(createProviderEvent(), { include: ['docs'] })).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'provider_result_invalid',
      data: expect.objectContaining({
        code: 'provider_result_invalid',
        provider: 'malformed-sitemap-provider',
        operation: 'sitemap entries',
        index: 1,
        field: 'loc'
      })
    })
  })

  test('provider-wire availableLocales order matches the graph-backed query for every requested locale', async () => {
    // The provider path reads the collection i18n config through
    // `getContentRuntimeConfig`; inject `runtime.content` (docs → { en, de },
    // defaultLocale en) so locale discovery + canonicalization run as in production.
    vi.resetModules()
    vi.doMock('../../packages/content/src/integrations/nitro/runtime-config', () => ({
      getContentRuntimeConfig: () => ({ content: runtime.content })
    }))

    const { resolveContentReference } = await import('../../packages/content/src/runtime/server/provider-query')
    const { buildContentGraph, resolveGraphVariant } = await import('../../packages/content/src/core/content/graph')

    // Same document, two locale variants. Graph insertion order en-then-de.
    const introDocs = [
      {
        id: 'content:en:guide:intro.md',
        collection: 'docs',
        canonicalKey: 'docs/intro',
        locale: 'en',
        path: '/guide/intro',
        title: 'Intro EN'
      },
      {
        id: 'content:de:guide:intro.md',
        collection: 'docs',
        canonicalKey: 'docs/intro',
        locale: 'de',
        path: '/leitfaden/einstieg',
        title: 'Intro DE'
      }
    ]

    // A CMS-style provider that answers each locale-scoped sub-query with the
    // single variant for that locale — so the provider path collects variants
    // in `localesToQuery` order (`[requestedLocale, ...fallbacks, ...configLocales]`),
    // which differs per requested locale before canonicalization.
    const query = vi.fn(async (_event: unknown, wire: any) => {
      const locale = wire?.plan?.resolveLocale?.locale
      const result = introDocs.filter(document => document.locale === locale)
      return { result, skip: 0, limit: 0, total: result.length }
    })
    externalProviderModules.set('cross-path-cms', {
      name: 'cross-path-cms',
      capabilities: {
        routeBackedCollections: false,
        dataCollections: true,
        localizedRoutes: false,
        translatedSlugs: true,
        navigation: false,
        surroundings: false,
        searchSections: false,
        sitemap: false,
        query: { operators: ['$eq'], pagination: [] }
      },
      query
    })
    runtime.content.provider = 'cross-path-cms'

    const graph = buildContentGraph(introDocs as any, { defaultLocale: 'en', locales: ['en', 'de'] })
    const graphAvailableLocales = (requestedLocale: string) =>
      resolveGraphVariant(graph, 'docs/intro', requestedLocale, {
        defaultLocale: 'en',
        locales: ['en', 'de'],
        localeFallback: { de: ['en'] },
        collection: 'docs'
      })?.availableLocales

    const providerAvailableLocales = async (requestedLocale: string) => {
      const resolved = await resolveContentReference(createProviderEvent(), 'docs/intro', {
        collection: 'docs',
        locale: requestedLocale,
        fallback: true
      })
      return resolved?.resolved?.availableLocales
    }

    // Graph-backed order is canonical (default-locale first) for both requests.
    expect(graphAvailableLocales('en')).toEqual(['en', 'de'])
    expect(graphAvailableLocales('de')).toEqual(['en', 'de'])

    // Provider-wire order matches the graph-backed order for BOTH requested
    // locales — not the per-request `localesToQuery` order. (Pre-fix, the
    // de-request provider path returns ['de', 'en'] and diverges here.)
    expect(await providerAvailableLocales('en')).toEqual(graphAvailableLocales('en'))
    expect(await providerAvailableLocales('de')).toEqual(graphAvailableLocales('de'))

    vi.doUnmock('../../packages/content/src/integrations/nitro/runtime-config')
  })

})
