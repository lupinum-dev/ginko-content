import { expect, test } from 'vitest'
import { contentProviderResultMarker, toContentProviderNavigationQuery, toContentProviderQuery, type ContentProvider, type ContentProviderCapabilities } from '../public/provider'
import { createAuthorDependencyProviderFixture, createFixtureContentProvider, createProviderFixtureEvent, getProviderFixtureCacheHint } from './provider-fixture'

export interface ProviderContractSuiteOptions {
  name: string
  expectedProviderName: string
  loadProvider: () => Promise<ContentProvider>
  createEvent: () => any
  /**
   * The capabilities the provider under test declares. Each capability block
   * runs its positive assertions only when the matching flag is `true`.
   * Operation capabilities (`routeBackedCollections`, `navigation`,
   * `surroundings`, `searchSections`, `sitemap`) and the query sub-capabilities
   * (`query.limit`/`skip`/`count`) additionally assert the typed provider error
   * when declared `false`; descriptive flags (`dataCollections`,
   * `localizedRoutes`, `translatedSlugs`) only gate their positive block.
   */
  expectedCapabilities: ContentProviderCapabilities
  collectNavPaths?: (items: Array<{ unprefixedPath?: string, children?: any[] }>) => string[]
}

export interface AuthorDependencyContractOptions {
  name: string
  loadProvider: () => Promise<ContentProvider>
  createEvent: () => any
  getCacheEvents: (provider: ContentProvider) => Array<{ type: string, key: string }>
}

const defaultCollectNavPaths = (items: Array<{ unprefixedPath?: string, children?: any[] }>): string[] =>
  items.flatMap(item => [
    item.unprefixedPath,
    ...defaultCollectNavPaths(item.children || [])
  ].filter(Boolean) as string[])

const unwrapProviderResult = <T>(value: T): T extends { data: infer Data } ? Data : T =>
  value && typeof value === 'object' && (value as Record<string, unknown>)[contentProviderResultMarker]
    ? (value as unknown as { data: any }).data
    : value as any

/**
 * Assert that a provider operation rejects with the typed
 * `unsupported_provider_operation` error when its capability is declared false.
 * The `run` callback may return a promise or throw synchronously.
 */
const expectUnsupportedOperation = (run: () => Promise<unknown> | undefined, operation: string) =>
  expect(Promise.resolve().then(run)).rejects.toMatchObject({
    statusCode: 400,
    statusMessage: 'unsupported_provider_operation',
    data: { code: 'unsupported_provider_operation', operation }
  })

const expectUnsupportedQueryShape = (run: () => Promise<unknown> | undefined, field: string) =>
  expect(Promise.resolve().then(run)).rejects.toMatchObject({
    statusCode: 400,
    statusMessage: 'unsupported_query_shape',
    data: { code: 'unsupported_query_shape', field }
  })

export const runProviderContractSuite = ({
  name,
  expectedProviderName,
  loadProvider,
  createEvent,
  expectedCapabilities,
  collectNavPaths = defaultCollectNavPaths
}: ProviderContractSuiteOptions) => {
  const caps = expectedCapabilities

  test(`${name} exposes explicit capabilities`, async () => {
    const provider = await loadProvider()

    expect(provider.name).toBe(expectedProviderName)
    expect(provider.capabilities).toMatchObject({
      ...caps,
      query: {
        limit: caps.query.limit,
        skip: caps.query.skip,
        count: caps.query.count
      }
    })
    expect(provider.capabilities.query.operators).toEqual(
      expect.arrayContaining(caps.query.operators)
    )
  })

  test(`${name} returns complete localized page and route metadata`, async () => {
    const provider = await loadProvider()
    const event = createEvent()

    if (!caps.routeBackedCollections) {
      await expectUnsupportedOperation(() => provider.page?.(event, 'docs', '/de/dokumentation/einstieg'), 'route-backed pages')
      await expectUnsupportedOperation(() => provider.routeMeta?.(event, 'docs', '/de/dokumentation/einstieg', { locale: 'de' }), 'route metadata')
      return
    }

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

    const miss = unwrapProviderResult(await provider.page?.(createEvent(), 'docs', '/de/dokumentation/not-found'))
    expect(miss).toBeNull()
  })

  test(`${name} supports list queries with locale, ordering, limit, count, and projection`, async () => {
    const provider = await loadProvider()

    if (!caps.query.limit) {
      await expectUnsupportedQueryShape(() => provider.query(createEvent(), toContentProviderQuery({
        collection: 'posts',
        resolveLocale: { locale: 'de', fallback: false },
        limit: 1
      })), 'limit')
    } else {
      const response = unwrapProviderResult(await provider.query(createEvent(), toContentProviderQuery({
        collection: 'posts',
        resolveLocale: { locale: 'de', fallback: false },
        sort: [{ date: -1 }],
        limit: 1,
        only: ['title', 'path', 'locale']
      }))) as { result: Array<{ title?: string, path?: string, locale?: string }>, total?: number }

      expect(response.result).toEqual([
        {
          title: 'Mehrsprachiges Onboarding',
          path: '/magazin/mehrsprachiges-onboarding',
          locale: 'de'
        }
      ])
      expect(typeof response.total).toBe('number')
    }

    if (!caps.query.count) {
      await expectUnsupportedQueryShape(() => provider.query(createEvent(), toContentProviderQuery({
        collection: 'posts',
        resolveLocale: { locale: 'de', fallback: false },
        count: true
      })), 'count')
    } else {
      const countResponse = unwrapProviderResult(await provider.query(createEvent(), toContentProviderQuery({
        collection: 'posts',
        resolveLocale: { locale: 'de', fallback: false },
        count: true
      })))
      expect(countResponse).toEqual({ result: 1 })
    }
  })

  test(`${name} produces navigation entries`, async () => {
    const provider = await loadProvider()
    const event = createEvent()

    if (!caps.navigation) {
      await expectUnsupportedOperation(() => provider.navigation?.(event, 'docs', { locale: 'de' }), 'navigation')
      const wire = toContentProviderNavigationQuery({ where: { locale: 'de' } })
      await expectUnsupportedOperation(() => provider.navigationQuery?.(event, wire.query, wire.options), 'navigation')
      return
    }

    const nav = unwrapProviderResult(await provider.navigation?.(event, 'docs', { locale: 'de' }))
    expect(collectNavPaths(nav || [])).toContain('/dokumentation/einstieg')
    expect(nav?.[0]).toEqual(expect.objectContaining({
      locale: 'de',
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

    const globalNavWire = toContentProviderNavigationQuery({ where: { locale: 'de' } })
    const globalNav = unwrapProviderResult(await provider.navigationQuery?.(event, globalNavWire.query, globalNavWire.options))
    const globalNavPaths = collectNavPaths(globalNav || [])
    expect(globalNavPaths).toContain('/dokumentation/einstieg')
    expect(globalNavPaths.length).toBeGreaterThan(0)

    const resolvedLocaleNavWire = toContentProviderNavigationQuery({
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: false, exact: true }
    })
    const resolvedLocaleNav = unwrapProviderResult(await provider.navigationQuery?.(event, resolvedLocaleNavWire.query, resolvedLocaleNavWire.options))
    expect(collectNavPaths(resolvedLocaleNav || [])).toContain('/dokumentation/einstieg')

    expect(JSON.stringify(nav)).not.toContain('Draft Roadmap')
  })

  test(`${name} produces surroundings entries`, async () => {
    const provider = await loadProvider()
    const event = createEvent()

    if (!caps.surroundings) {
      await expectUnsupportedOperation(() => provider.surroundings?.(event, 'docs', '/de/dokumentation/einstieg/installation', { locale: 'de' }), 'surroundings')
      return
    }

    const surround = unwrapProviderResult(await provider.surroundings?.(event, 'docs', '/de/dokumentation/einstieg/installation', { locale: 'de' }))
    expect(surround).toHaveLength(2)
    expect(surround?.map(item => item?.unprefixedPath)).toContain('/dokumentation/einstieg/alltag')
  })

  test(`${name} produces search sections`, async () => {
    const provider = await loadProvider()
    const event = createEvent()

    if (!caps.searchSections) {
      await expectUnsupportedOperation(() => provider.searchSections?.(event, 'docs', { locale: 'de' }), 'search sections')
      return
    }

    const sections = unwrapProviderResult(await provider.searchSections?.(event, 'docs', { locale: 'de' }))
    expect(sections?.some(section => section.id.startsWith('/de/dokumentation/einstieg') || section.id.startsWith('/dokumentation/einstieg'))).toBe(true)
    expect(JSON.stringify(sections)).not.toContain('Draft Roadmap')
  })

  test(`${name} produces sitemap entries`, async () => {
    const provider = await loadProvider()
    const event = createEvent()

    if (!caps.sitemap) {
      await expectUnsupportedOperation(() => provider.sitemapEntries?.(event, { include: ['docs'] }), 'sitemap entries')
      return
    }

    const sitemap = unwrapProviderResult(await provider.sitemapEntries?.(event, { include: ['docs'] }))
    expect(sitemap?.some(entry => entry.loc.endsWith('/de/dokumentation/einstieg'))).toBe(true)
    expect(JSON.stringify(sitemap)).not.toContain('/docs/draft-roadmap')
  })

  test(`${name} emits cache hints for rendered content`, async () => {
    if (!caps.routeBackedCollections) return

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
    if (!caps.dataCollections) return

    const provider = await loadProvider()
    const response = unwrapProviderResult(await provider.query(createEvent(), toContentProviderQuery({
      collection: 'versions',
      resolveLocale: { locale: 'en', fallback: false },
      sort: [{ date: -1 }]
    }))) as { result: Array<{ title?: string }> }

    expect(response.result[0]?.title).toBe('Launch readiness')

    if (caps.sitemap) {
      await expect(provider.sitemapEntries?.(createEvent(), { include: ['versions'] })).rejects.toMatchObject({
        statusCode: 400,
        statusMessage: 'data_collection_sitemap_access',
        data: {
          code: 'data_collection_sitemap_access',
          collection: 'versions'
        }
      })
    }
  })

  test(`${name} fails loudly for unsupported query operators and unknown collections`, async () => {
    const provider = await loadProvider()

    // Globally-invalid operators are rejected while lowering to the wire plan,
    // before the query ever reaches the provider (CS-5).
    expect(() => toContentProviderQuery({
      collection: 'posts',
      where: { title: { $near: 'launch' } } as never
    })).toThrow(/Unsupported content query operator: \$near/)

    await expect(provider.query(createEvent(), toContentProviderQuery({
      collection: 'missing'
    }))).rejects.toMatchObject({
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
