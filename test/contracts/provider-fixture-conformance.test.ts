import { describe, expect, test } from 'vitest'
import { createFixtureContentProvider, createProviderFixture, createProviderFixtureEvent, createSaasProviderFixture } from '../../packages/content/src/testing/provider-fixture'
import { runAuthorDependencyFixtureSelfTest, runSaasProviderFixtureContractSuite } from '../../packages/content/src/testing/provider-contract'
import { getContentCacheHint } from '../../packages/content/src/runtime/server/cache-hints'
import { normalizeProviderQueryResponse } from '../../packages/content/src/runtime/server/provider-query'

const expectProviderResultInvalid = (callback: () => unknown) => {
  expect(callback).toThrow(expect.objectContaining({
    data: expect.objectContaining({ code: 'provider_result_invalid' })
  }))
}

describe('provider fixture conformance', () => {
  const fixture = createSaasProviderFixture()
  const provider = createFixtureContentProvider(fixture)
  const collectNavPaths = (items: Array<{ canonicalPath?: string, children?: any[] }>): string[] =>
    items.flatMap(item => [
      item.canonicalPath,
      ...collectNavPaths(item.children || [])
    ].filter(Boolean) as string[])

  runSaasProviderFixtureContractSuite({
    name: 'provider fixture',
    expectedProviderName: 'fixture',
    loadProvider: async () => provider,
    createEvent: () => createProviderFixtureEvent({ fixture, provider }),
    collectNavPaths
  })
  runAuthorDependencyFixtureSelfTest()

  test('shapes a minimal-set provider into the canonical route envelope', async () => {
    // Documents carry ONLY the minimal fields a third-party provider must emit
    // (no id, canonicalKey, type or file). Core derives id/canonicalKey/type on
    // normalization and the route envelope (path, variants, localePaths,
    // resolved) on shaping — proving a minimal-set provider passes conformance.
    const minimalFixture = createProviderFixture({
      defaultLocale: 'en',
      locales: ['en'],
      collections: {
        blog: { type: 'page', route: '/blog' }
      },
      documents: [
        { collection: 'blog', locale: 'en', path: '/blog/hello', title: 'Hello' },
        { collection: 'blog', locale: 'en', path: '/blog/world', title: 'World' }
      ]
    })
    const minimalProvider = createFixtureContentProvider(minimalFixture)
    const event = createProviderFixtureEvent({ fixture: minimalFixture, provider: minimalProvider })

    // Core filled the derivable identity fields from the minimal input.
    const [first] = minimalFixture.documents
    expect(first.id).toBe('content:en:blog:hello.md')
    expect(first.canonicalKey).toBe('blog:blog/hello')
    expect(first.type).toBe('markdown')

    const page = await minimalProvider.page(event, 'blog', '/blog/hello')
    expect(page).toMatchObject({
      path: '/blog/hello',
      canonicalPath: '/blog/hello',
      locale: 'en',
      resolved: expect.objectContaining({ locale: 'en', fallback: false })
    })

    const sitemap = await minimalProvider.sitemapEntries!(event)
    expect(sitemap.map(entry => entry.loc).sort()).toEqual(['/blog/hello', '/blog/world'])
  })

  test('projects localized non-doc collection mounts consistently', async () => {
    const event = createProviderFixtureEvent({ fixture, provider })
    const sitemap = await provider.sitemapEntries(event, { include: ['posts'] })

    expect(sitemap).toContainEqual({
      loc: '/de/magazin/mehrsprachiges-onboarding'
    })
    expect(sitemap.some(entry => entry.loc.includes('/de/blog/magazin/'))).toBe(false)

    const results = await provider.search!(event, { term: 'Mehrsprachiges', locale: 'de' })
    expect(results[0]?.path).toBe('/de/magazin/mehrsprachiges-onboarding')
  })

  test('sitemap entries exclude navigation marker documents', async () => {
    const navFixture = createProviderFixture({
      defaultLocale: 'en',
      locales: ['en'],
      collections: {
        pages: { type: 'page', route: '/pages' }
      },
      documents: [
        { collection: 'pages', path: '/pages/home', title: 'Home' },
        { collection: 'pages', path: '/pages/about', title: 'About' },
        // navigationFile alone must exclude this from the sitemap — no `partial`
        // here, so the test fails if the navigationFile filter regresses.
        { collection: 'pages', path: '/pages/about', title: 'Nav Marker', navigationFile: true }
      ]
    })
    const navProvider = createFixtureContentProvider(navFixture)
    const event = createProviderFixtureEvent({ fixture: navFixture, provider: navProvider })

    const sitemap = await navProvider.sitemapEntries!(event)
    const locs = sitemap.map(entry => entry.loc)

    expect(locs).toContain('/pages/home')
    expect(locs.filter(loc => loc === '/pages/about')).toHaveLength(1)
  })

  test('applies provider search collection filters and section options', async () => {
    const event = createProviderFixtureEvent({ fixture, provider })

    await expect(provider.search!(event, {
      term: 'Markdown',
      locale: 'de',
      collections: ['posts']
    })).resolves.toEqual([])

    await expect(provider.search!(event, {
      term: 'Markdown',
      locale: 'de',
      collections: ['docs']
    })).resolves.toEqual([
      expect.objectContaining({
        title: 'Markdown Syntax DE',
        path: '/de/dokumentation/grundlagen/markdown-syntax'
      })
    ])

    const sections = await provider.searchSections!(event, 'posts', {
      locale: 'de',
      filterQuery: { title: { $icontains: 'Onboarding' } },
      extraFields: ['authors', 'locale']
    })

    expect(sections).toEqual([
      expect.objectContaining({
        id: '/de/magazin/mehrsprachiges-onboarding',
        authors: ['authors.emily'],
        locale: 'de'
      })
    ])
  })

  test('always keeps the default locale in custom fixture locale lists', () => {
    const custom = createProviderFixture({
      defaultLocale: 'en',
      locales: ['de'],
      collections: {
        docs: {
          type: 'page',
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
          route: { en: '/docs', de: '/dokumentation' }
        }
      },
      documents: []
    })

    expect(custom.locales).toEqual(['en', 'de'])
  })

  test('collects provider cache hints for rendered pages', async () => {
    const event = createProviderFixtureEvent({ fixture, provider })

    await provider.page(event, 'posts', '/de/magazin/mehrsprachiges-onboarding')

    expect(getContentCacheHint(event)).toMatchObject({
      tags: expect.arrayContaining([
        'entry:posts:posts.onboarding',
        'entry:authors:emily',
        'collection:posts',
        'route:/de/magazin/mehrsprachiges-onboarding'
      ]),
      paths: ['/de/magazin/mehrsprachiges-onboarding']
    })
  })

  test('preserves exact locale misses for page lookups', async () => {
    const event = createProviderFixtureEvent({ fixture, provider })

    await expect(provider.page(event, 'docs', '/de/dokumentation/einstieg/installation', {
      locale: 'en',
      exact: true
    })).resolves.toBeNull()
  })

  test('accepts only canonical provider query envelopes', () => {
    expect(normalizeProviderQueryResponse<{ title: string }>({
      collection: 'docs'
    }, {
      result: [{ title: 'Intro' }],
      skip: 0,
      limit: 1,
      total: 1
    })).toEqual({
      result: [{ title: 'Intro' }],
      skip: 0,
      limit: 1,
      total: 1
    })

    expect(normalizeProviderQueryResponse<{ title: string }>({
      collection: 'docs',
      first: true
    }, {
      result: { title: 'Intro' }
    })).toEqual({
      result: { title: 'Intro' }
    })

    expect(normalizeProviderQueryResponse({
      collection: 'docs',
      count: true
    }, {
      result: 1
    })).toEqual({
      result: 1
    })
  })

  test('rejects malformed provider query results instead of silently normalizing them', () => {
    expectProviderResultInvalid(() => normalizeProviderQueryResponse({ collection: 'docs' }, [{ title: 'Intro' }]))
    expectProviderResultInvalid(() => normalizeProviderQueryResponse({ collection: 'docs' }, { title: 'Intro' }))
    expectProviderResultInvalid(() => normalizeProviderQueryResponse({ collection: 'docs' }, undefined))
    expectProviderResultInvalid(() => normalizeProviderQueryResponse({ collection: 'docs', count: true }, []))
    expectProviderResultInvalid(() => normalizeProviderQueryResponse({ collection: 'docs', count: true }, 1))
    expectProviderResultInvalid(() => normalizeProviderQueryResponse({ collection: 'docs' }, 2))
    expectProviderResultInvalid(() => normalizeProviderQueryResponse({ collection: 'docs' }, {
      result: [{ title: 'Intro' }],
      skip: 0,
      limit: 10
    } as never))
    expectProviderResultInvalid(() => normalizeProviderQueryResponse({ collection: 'docs' }, {
      result: 'raw-value'
    }))
    expectProviderResultInvalid(() => normalizeProviderQueryResponse({ collection: 'docs', first: true }, [
      { title: 'Intro' }
    ]))
    expectProviderResultInvalid(() => normalizeProviderQueryResponse({ collection: 'docs', first: true }, { title: 'Intro' }))
  })

  test('records route dependencies and invalidates only author-dependent routes', async () => {
    const authorFixture = createProviderFixture({
      defaultLocale: 'en',
      locales: ['en'],
      collections: {
        posts: { type: 'page', route: '/blog' },
        authors: { type: 'page', route: '/authors' }
      },
      documents: [
        { collection: 'authors', path: '/authors/alice', ref: 'authors.alice', title: 'Alice' },
        { collection: 'authors', path: '/authors/bob', ref: 'authors.bob', title: 'Bob' },
        ...Array.from({ length: 5 }, (_, index) => ({
          collection: 'posts',
          path: `/blog/post-${index + 1}`,
          ref: `posts.post-${index + 1}`,
          title: `Post ${index + 1}`,
          authors: ['authors.alice']
        })),
        { collection: 'posts', path: '/blog/post-6', ref: 'posts.post-6', title: 'Post 6', authors: ['authors.bob'] }
      ]
    })
    const authorProvider = createFixtureContentProvider(authorFixture)
    const event = createProviderFixtureEvent({ fixture: authorFixture, provider: authorProvider })

    for (const index of [1, 2, 3, 4, 5, 6]) {
      await authorProvider.page(event, 'posts', `/blog/post-${index}`)
    }

    await authorProvider.invalidate!(event, { tags: ['entry:authors:alice'] })

    const purgedPaths = authorProvider.cache.events
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

  test('records cache hits and misses around invalidation', async () => {
    const event = createProviderFixtureEvent({ fixture, provider })

    await provider.page(event, 'docs', '/de/dokumentation/einstieg')
    await provider.page(event, 'docs', '/de/dokumentation/einstieg')
    await provider.invalidate!(event, { paths: ['/de/dokumentation/einstieg'] })
    await provider.page(event, 'docs', '/de/dokumentation/einstieg')

    expect(provider.cache.events.map(event => event.type)).toEqual(expect.arrayContaining(['miss', 'hit', 'purge']))
    expect(provider.cache.events.filter(event => event.type === 'miss').length).toBeGreaterThanOrEqual(2)
  })

  test('updates reverse dependency edges when a route is rerendered with different tags', async () => {
    const authorFixture = createProviderFixture({
      defaultLocale: 'en',
      locales: ['en'],
      collections: {
        posts: { type: 'page', route: '/blog' },
        authors: { type: 'page', route: '/authors' }
      },
      documents: [
        { collection: 'authors', path: '/authors/alice', ref: 'authors.alice', title: 'Alice' },
        { collection: 'authors', path: '/authors/bob', ref: 'authors.bob', title: 'Bob' },
        { collection: 'posts', path: '/blog/post-1', ref: 'posts.post-1', title: 'Post 1', author: 'authors.alice' }
      ]
    })
    const authorProvider = createFixtureContentProvider(authorFixture)
    const event = createProviderFixtureEvent({ fixture: authorFixture, provider: authorProvider })

    await authorProvider.page(event, 'posts', '/blog/post-1')
    ;(authorFixture.documents.find(document => document.ref === 'posts.post-1') as any).author = 'authors.bob'
    await authorProvider.page(event, 'posts', '/blog/post-1')
    await authorProvider.invalidate!(event, { tags: ['entry:authors:alice'] })

    const purgedPaths = authorProvider.cache.events
      .filter(event => event.type === 'purge')
      .map(event => event.key)

    expect(purgedPaths).not.toContain('/blog/post-1')
  })
})
