import { expect, test } from 'vitest'
import { contentProviderResultMarker, type ContentProvider } from '../public/provider'
import { createAuthorDependencyProviderFixture, createFixtureContentProvider, createProviderFixtureEvent, getProviderFixtureCacheHint } from './provider-fixture'

export interface SaasProviderFixtureContractSuiteOptions {
  name: string
  expectedProviderName: string
  loadProvider: () => Promise<ContentProvider>
  createEvent: () => any
  collectNavPaths?: (items: Array<{ canonicalPath?: string, children?: any[] }>) => string[]
}

export interface AuthorDependencyContractOptions {
  name: string
  loadProvider: () => Promise<ContentProvider>
  createEvent: () => any
  getCacheEvents: (provider: ContentProvider) => Array<{ type: string, key: string }>
}

const defaultCollectNavPaths = (items: Array<{ canonicalPath?: string, children?: any[] }>): string[] =>
  items.flatMap(item => [
    item.canonicalPath,
    ...defaultCollectNavPaths(item.children || [])
  ].filter(Boolean) as string[])

const unwrapProviderResult = <T>(value: T): T extends { data: infer Data } ? Data : T =>
  value && typeof value === 'object' && (value as Record<string, unknown>)[contentProviderResultMarker]
    ? (value as unknown as { data: any }).data
    : value as any

export const runSaasProviderFixtureContractSuite = ({
  name,
  expectedProviderName,
  loadProvider,
  createEvent,
  collectNavPaths = defaultCollectNavPaths
}: SaasProviderFixtureContractSuiteOptions) => {
  test(`${name} exposes explicit capabilities`, async () => {
    const provider = await loadProvider()

    expect(provider.name).toBe(expectedProviderName)
    expect(provider.capabilities).toMatchObject({
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
    expect(provider.capabilities.query.operators).toContain('$eq')
    expect(provider.capabilities.query.operators).toContain('$contains')
  })

  test(`${name} returns complete localized page and route metadata`, async () => {
    const provider = await loadProvider()
    const event = createEvent()
    const page = unwrapProviderResult(await provider.page?.(event, 'docs', '/de/dokumentation/einstieg'))

    expect(page).toMatchObject({
      title: 'Einstieg',
      locale: 'de',
      path: '/de/dokumentation/einstieg',
      defaultLocale: 'en',
      resolved: expect.objectContaining({
        requestedLocale: 'de',
        locale: 'de',
        fallback: false
      })
    })
    expect(page?.variants).toEqual(expect.any(Array))
    expect(page?.localePaths).toEqual(expect.any(Object))

    const routeMeta = unwrapProviderResult(await provider.routeMeta?.(event, 'docs', '/de/dokumentation/einstieg', { locale: 'de' }))
    expect(routeMeta).toMatchObject({
      locale: 'de',
      path: expect.stringMatching(/\/dokumentation\/einstieg$/),
      defaultLocale: 'en',
      resolved: expect.objectContaining({
        requestedLocale: 'de',
        locale: 'de'
      })
    })
  })

  test(`${name} supports localized page misses without fallback routes`, async () => {
    const provider = await loadProvider()
    const miss = unwrapProviderResult(await provider.page?.(createEvent(), 'docs', '/de/dokumentation/not-found'))
    expect(miss).toBeNull()
  })

  test(`${name} supports list queries with locale, ordering, limit, count, and projection`, async () => {
    const provider = await loadProvider()
    const response = unwrapProviderResult(await provider.query(createEvent(), {
      collection: 'posts',
      resolveLocale: { locale: 'de', fallback: false },
      sort: [{ date: -1 }],
      limit: 1,
      only: ['title', 'path', '_locale']
    })) as { result: Array<{ title?: string, path?: string, _locale?: string }>, total?: number }

    expect(response.result).toEqual([
      {
        title: 'Mehrsprachiges Onboarding',
        path: '/magazin/mehrsprachiges-onboarding',
        _locale: 'de'
      }
    ])
    expect(typeof response.total).toBe('number')

    const countResponse = unwrapProviderResult(await provider.query(createEvent(), {
      collection: 'posts',
      resolveLocale: { locale: 'de', fallback: false },
      count: true
    }))
    expect(countResponse).toEqual({ result: 1 })
  })

  test(`${name} produces navigation, surroundings, search sections, and sitemap entries`, async () => {
    const provider = await loadProvider()
    const event = createEvent()

    const nav = unwrapProviderResult(await provider.navigation?.(event, 'docs', { locale: 'de' }))
    expect(collectNavPaths(nav || [])).toContain('/dokumentation/einstieg')
    expect(nav?.[0]).toEqual(expect.objectContaining({
      _locale: 'de',
      ref: expect.any(String),
      stableId: expect.any(String)
    }))
    const navPaths = collectNavPaths(nav || [])
    expect(navPaths.filter(path => path === '/dokumentation/einstieg')).toHaveLength(1)
    expect(navPaths).not.toContain('/docs/getting-started')
    expect(navPaths.indexOf('/dokumentation/einstieg')).toBeLessThan(
      navPaths.indexOf('/dokumentation/einstieg/installation')
    )

    const fieldNav = unwrapProviderResult(await provider.navigation?.(event, 'docs', ['description']))
    expect(fieldNav?.[0]).toEqual(expect.objectContaining({
      title: expect.any(String),
      description: expect.any(String)
    }))

    const globalNav = unwrapProviderResult(await provider.navigationQuery?.(event, { where: { _locale: 'de' } }))
    const globalNavPaths = collectNavPaths(globalNav || [])
    expect(globalNavPaths).toContain('/dokumentation/einstieg')
    expect(globalNavPaths.length).toBeGreaterThan(0)

    const resolvedLocaleNav = unwrapProviderResult(await provider.navigationQuery?.(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: false, exact: true }
    }))
    expect(collectNavPaths(resolvedLocaleNav || [])).toContain('/dokumentation/einstieg')

    const surround = unwrapProviderResult(await provider.surroundings?.(event, 'docs', '/de/dokumentation/einstieg/installation', { locale: 'de' }))
    expect(surround).toHaveLength(2)
    expect(surround?.map(item => item?.canonicalPath)).toContain('/dokumentation/einstieg/alltag')

    const sections = unwrapProviderResult(await provider.searchSections?.(event, 'docs', { locale: 'de' }))
    expect(sections?.some(section => section.id.startsWith('/de/dokumentation/einstieg') || section.id.startsWith('/dokumentation/einstieg'))).toBe(true)
    expect(JSON.stringify(sections)).not.toContain('Draft Roadmap')

    const sitemap = unwrapProviderResult(await provider.sitemapEntries?.(event, { include: ['docs'] }))
    expect(sitemap?.some(entry => entry.loc.endsWith('/de/dokumentation/einstieg'))).toBe(true)
    expect(JSON.stringify(sitemap)).not.toContain('/docs/draft-roadmap')
    expect(JSON.stringify(nav)).not.toContain('Draft Roadmap')
  })

  test(`${name} emits cache hints for rendered content`, async () => {
    const provider = await loadProvider()
    const event = createEvent()

    await provider.page?.(event, 'posts', '/de/magazin/mehrsprachiges-onboarding')

    expect(getProviderFixtureCacheHint(event)).toMatchObject({
      tags: expect.arrayContaining([
        'entry:posts:posts.onboarding',
        'entry:authors:emily',
        'collection:posts',
        'route:/de/magazin/mehrsprachiges-onboarding'
      ]),
      paths: ['/de/magazin/mehrsprachiges-onboarding']
    })

    if (provider.siteData) {
      const siteDataEvent = createEvent()
      await provider.siteData(siteDataEvent, { key: 'settings', locale: 'de' })
      expect(getProviderFixtureCacheHint(siteDataEvent)).toMatchObject({
        tags: ['site-data:settings:de']
      })
    }
  })

  test(`${name} supports data-only collection reads and rejects data-only sitemap access`, async () => {
    const provider = await loadProvider()
    const response = unwrapProviderResult(await provider.query(createEvent(), {
      collection: 'versions',
      resolveLocale: { locale: 'en', fallback: false },
      sort: [{ date: -1 }]
    })) as { result: Array<{ title?: string }> }

    expect(response.result[0]?.title).toBe('Launch readiness')
    await expect(provider.sitemapEntries?.(createEvent(), { include: ['versions'] })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'data_collection_sitemap_access',
      data: {
        code: 'data_collection_sitemap_access',
        collection: 'versions'
      }
    })
  })

  test(`${name} fails loudly for unsupported query operators and unknown collections`, async () => {
    const provider = await loadProvider()

    await expect(provider.query(createEvent(), {
      collection: 'posts',
      where: { title: { $near: 'launch' } } as never
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'unsupported_query_operator',
      data: {
        code: 'unsupported_query_operator',
        operator: '$near'
      }
    })

    await expect(provider.query(createEvent(), {
      collection: 'missing'
    })).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'unknown_collection',
      data: {
        code: 'unknown_collection',
        collection: 'missing'
      }
    })
  })
}

export const createAuthorDependencyContractProvider = () => {
  const fixture = createAuthorDependencyProviderFixture()
  const provider = createFixtureContentProvider(fixture)
  return {
    fixture,
    provider,
    createEvent: () => createProviderFixtureEvent({ fixture, provider }),
    getCacheEvents: () => provider.cache.events
  }
}

export const runAuthorDependencyContractTest = (options: AuthorDependencyContractOptions) => {
  test(`${options.name} invalidates Alice posts without purging Bob posts`, async () => {
    const provider = await options.loadProvider()
    const event = options.createEvent()

    for (const index of [1, 2, 3, 4, 5, 6]) {
      await provider.page?.(event, 'blog', `/blog/post-${index}`)
    }

    await provider.invalidate?.(event, { tags: ['entry:authors:alice'] })

    const events = options.getCacheEvents(provider)
    const purgedPaths = events
      .filter(event => event.type === 'purge')
      .map(event => event.key)
      .sort()

    expect(purgedPaths).toEqual([
      '/blog/post-1',
      '/blog/post-2',
      '/blog/post-3',
      '/blog/post-4',
      '/blog/post-5'
    ])
    expect(purgedPaths).not.toContain('/blog/post-6')
  })
}

export const runAuthorDependencyFixtureSelfTest = () => {
  const harness = createAuthorDependencyContractProvider()
  runAuthorDependencyContractTest({
    name: 'author dependency fixture',
    loadProvider: async () => harness.provider,
    createEvent: harness.createEvent,
    getCacheEvents: harness.getCacheEvents
  })
}
