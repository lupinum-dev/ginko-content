import { describe, expect, test } from 'vitest'
import {
  createFixtureContentProvider,
  createProviderFixture,
  createProviderFixtureEvent
} from '../../packages/content/src/testing/provider-fixture'
import {
  assertGeneratedSitemaps,
  createSitemapAssertionTargetsFromPrerenderedSitemaps,
  normalizeContentSitemapAssertOptions
} from '../../packages/content/src/module/sitemap-assert'
import { toContentProviderQuery } from '../../packages/content/src/public/provider'
import type { ContentProviderQuery, ContentProviderVariantSelector } from '../../packages/content/src/public/provider'
import { normalizeProviderQueryResponse } from '../../packages/content/src/runtime/server/provider-query'
import {
  normalizeProviderRoutes,
  projectProviderNavigation,
  projectProviderRouteFact,
  projectProviderSearchResults,
  projectProviderSurroundings
} from '../../packages/content/src/runtime/server/provider-route-facts'

describe('provider route golden contract', () => {
  const closedVariantQuery = (
    collection: string,
    variant: ContentProviderVariantSelector
  ): ContentProviderQuery => {
    const query = toContentProviderQuery({ collection, first: true })
    return { ...query, plan: { ...query.plan, variant } }
  }

  test('drives every route-bearing consumer from one raw provider contract', async () => {
    const fixture = createProviderFixture({
      name: 'provider-route-golden',
      providerName: 'fixture',
      defaultLocale: 'en',
      locales: ['en', 'de'],
      collections: {
        docs: {
          type: 'page',
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
          route: { en: '/docs', de: '/dokumentation' }
        },
        blog: {
          type: 'page',
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
          route: '/blog'
        },
        authors: {
          type: 'data',
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
          sitemap: false
        }
      },
      documents: [
        { collection: 'docs', canonicalKey: 'docs:start', locale: 'en', path: '/docs/start', ref: 'docs.start', title: 'Start', description: 'Start here', order: 1 },
        { collection: 'docs', canonicalKey: 'docs:start', locale: 'de', path: '/dokumentation/start', ref: 'docs.start', title: 'Startseite', description: 'Hier starten', order: 1 },
        { collection: 'docs', canonicalKey: 'docs:install', locale: 'en', path: '/docs/install', ref: 'docs.install', title: 'Install', order: 2 },
        { collection: 'blog', canonicalKey: 'blog:release', locale: 'en', path: '/blog/release', ref: 'blog.release', title: 'Release', description: 'Release post', authors: ['authors.ada'], order: 1 },
        { collection: 'blog', canonicalKey: 'blog:release', locale: 'de', path: '/blog/veroeffentlichung', ref: 'blog.release', title: 'Veroeffentlichung', description: 'Release auf Deutsch', authors: ['authors.ada'], order: 1 },
        { collection: 'authors', canonicalKey: 'authors:ada', locale: 'en', path: '/authors/ada', ref: 'authors.ada', title: 'Ada', name: 'Ada' },
        { collection: 'authors', canonicalKey: 'authors:ada', locale: 'de', path: '/autoren/ada', ref: 'authors.ada', title: 'Ada', name: 'Ada' }
      ]
    })
    const provider = createFixtureContentProvider(fixture)
    const event = createProviderFixtureEvent({ fixture, provider })

    const pageParams = {
      collection: 'docs',
      first: true,
      resolveVariant: {
        route: '/de/dokumentation/start',
        locale: 'de',
        fallback: true
      }
    }
    const pageResponse = normalizeProviderQueryResponse(
      pageParams,
      await provider.query(event, closedVariantQuery('docs', {
        by: 'route',
        requestedRoute: '/de/dokumentation/start',
        requestedLocale: 'de',
        candidates: [
          { locale: 'de', contentPath: '/dokumentation/start' },
          { locale: 'en', contentPath: '/docs/start' }
        ]
      })),
      provider.name,
      fixture.runtime
    )
    expect(pageResponse.result).toMatchObject({
      title: 'Startseite',
      route: {
        requestedPath: '/de/dokumentation/start',
        resolvedPath: '/de/dokumentation/start',
        alternates: expect.arrayContaining([
          { locale: 'en', path: '/docs/start', source: 'variant' },
          { locale: 'de', path: '/de/dokumentation/start', source: 'variant' }
        ])
      },
      resolution: { usedFallback: false }
    })

    const navigationQuery = toContentProviderQuery({
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      sort: [{ order: 1 }]
    })
    const navigation = projectProviderNavigation(
      await provider.navigation!(event, navigationQuery),
      provider.name,
      fixture.runtime,
      'de'
    )
    expect(navigation.map(item => item.path)).toEqual([
      '/de/dokumentation/start',
      '/de/dokumentation/install'
    ])

    const surroundings = projectProviderSurroundings(
      await provider.surroundings!(event, 'docs', '/docs/start', { locale: 'en' }),
      provider.name,
      fixture.runtime
    )
    expect(surroundings[0]).toMatchObject({ path: '/docs/install' })

    const posts = await provider.query(event, toContentProviderQuery({
      collection: 'blog',
      resolveLocale: { locale: 'de', fallback: false },
      only: ['title', 'authors'],
      sort: [{ order: 1 }]
    })) as { result: Array<Record<string, unknown>> }
    expect(posts.result[0]).toMatchObject({
      title: 'Veroeffentlichung',
      authors: ['authors.ada']
    })

    const search = projectProviderSearchResults(
      await provider.search!(event, { term: 'veroeffentlichung', locale: 'de', collections: ['blog'] }),
      provider.name,
      fixture.runtime
    )
    expect(search[0]).toMatchObject({ path: '/de/blog/veroeffentlichung' })

    const routes = normalizeProviderRoutes(await provider.routes!(event), provider.name)
    expect(routes.some(route => route.collection === 'authors')).toBe(false)
    expect(routes.map(route => projectProviderRouteFact(route, fixture.runtime))).toEqual(expect.arrayContaining([
      '/de/dokumentation/start',
      '/de/blog/veroeffentlichung'
    ]))

    const targets = createSitemapAssertionTargetsFromPrerenderedSitemaps([{
      name: '/sitemap.xml',
      content: '<urlset><url><loc>https://demo.ginko-content.dev/de/dokumentation/start</loc></url><url><loc>https://demo.ginko-content.dev/de/blog/veroeffentlichung</loc></url></urlset>'
    }])
    await expect(assertGeneratedSitemaps({
      options: normalizeContentSitemapAssertOptions({
        enabled: true,
        requiredPaths: ['/de/dokumentation/start', '/de/blog/veroeffentlichung'],
        forbiddenPathPrefixes: ['/authors'],
        requireProductionSiteUrl: true
      }),
      collectionRouteCounts: { docs: 2, blog: 1 },
      targets
    })).resolves.toBeUndefined()
  })

  test('publishes only route alternates proven by the selected provider document', async () => {
    const fixture = createProviderFixture({
      name: 'provider-route-proof',
      providerName: 'fixture',
      defaultLocale: 'en',
      locales: ['en', 'de'],
      localeFallback: { de: ['en'] },
      collections: {
        docs: {
          type: 'page',
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
          route: { en: '/docs', de: '/dokumentation' }
        }
      },
      documents: [
        { collection: 'docs', canonicalKey: 'docs:a', locale: 'en', path: '/docs/setup', ref: 'docs.a', title: 'A' },
        { collection: 'docs', canonicalKey: 'docs:b', locale: 'de', path: '/dokumentation/setup', ref: 'docs.b', title: 'B' },
        { collection: 'docs', canonicalKey: 'docs:draft', locale: 'en', path: '/docs/public', ref: 'docs.draft', title: 'Public' },
        { collection: 'docs', canonicalKey: 'docs:draft', locale: 'de', path: '/dokumentation/entwurf', ref: 'docs.draft', title: 'Entwurf', draft: true }
      ]
    })
    const provider = createFixtureContentProvider(fixture)
    const event = createProviderFixtureEvent({ fixture, provider })

    const routeParams = {
      collection: 'docs',
      first: true,
      resolveVariant: {
        route: '/de/dokumentation/setup',
        locale: 'de',
        fallback: ['en']
      }
    }
    const routeResponse = normalizeProviderQueryResponse(
      routeParams,
      await provider.query(event, closedVariantQuery('docs', {
        by: 'route',
        requestedRoute: '/de/dokumentation/setup',
        requestedLocale: 'de',
        candidates: [
          { locale: 'de', contentPath: '/dokumentation/setup' },
          { locale: 'en', contentPath: '/docs/setup' }
        ]
      })),
      provider.name,
      fixture.runtime
    )
    expect(routeResponse.result).toMatchObject({
      canonicalKey: 'docs:b',
      route: {
        alternates: [
          { locale: 'de', path: '/de/dokumentation/setup', source: 'variant' }
        ]
      }
    })

    const refParams = {
      collection: 'docs',
      first: true,
      resolveVariant: {
        ref: 'docs.a',
        locale: 'de',
        fallback: ['en']
      }
    }
    const refResponse = normalizeProviderQueryResponse(
      refParams,
      await provider.query(event, closedVariantQuery('docs', {
        by: 'ref',
        requestedRef: 'docs.a',
        requestedLocale: 'de',
        localeChain: ['de', 'en']
      })),
      provider.name,
      fixture.runtime
    )
    expect(refResponse.result).toMatchObject({
      canonicalKey: 'docs:a',
      route: {
        alternates: [
          { locale: 'en', path: '/docs/setup', source: 'variant' }
        ]
      },
      resolution: { usedFallback: true }
    })

    const publicParams = {
      collection: 'docs',
      first: true,
      resolveVariant: {
        ref: 'docs.draft',
        locale: 'en',
        fallback: false
      }
    }
    const publicResponse = normalizeProviderQueryResponse(
      publicParams,
      await provider.query(event, closedVariantQuery('docs', {
        by: 'ref',
        requestedRef: 'docs.draft',
        requestedLocale: 'en',
        localeChain: ['en']
      })),
      provider.name,
      fixture.runtime
    )
    expect(publicResponse.result).toMatchObject({
      route: {
        alternates: [
          { locale: 'en', path: '/docs/public', source: 'variant' }
        ]
      }
    })
  })
})
