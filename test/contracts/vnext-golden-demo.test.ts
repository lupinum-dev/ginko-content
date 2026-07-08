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
import { contentProviderResultMarker } from '../../packages/content/src/public/provider'

const unwrap = <T>(value: T): T extends { data: infer Data } ? Data : T =>
  value && typeof value === 'object' && (value as Record<string, unknown>)[contentProviderResultMarker]
    ? (value as { data: any }).data
    : value as any

describe('vNext golden demo', () => {
  test('proves docs, blog, authors, i18n, search, navigation, surroundings, route meta, and sitemap from one public provider shape', async () => {
    const fixture = createProviderFixture({
      name: 'vnext-golden-demo',
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
          route: { en: '/blog', de: '/blog' }
        },
        authors: {
          type: 'data',
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
          sitemap: false
        }
      },
      documents: [
        {
          collection: 'docs',
          canonicalKey: 'docs:start',
          locale: 'en',
          path: '/docs/start',
          ref: 'docs.start',
          title: 'Start',
          description: 'Start here',
          order: 1
        },
        {
          collection: 'docs',
          canonicalKey: 'docs:start',
          locale: 'de',
          path: '/dokumentation/start',
          ref: 'docs.start',
          title: 'Startseite',
          description: 'Hier starten',
          order: 1
        },
        {
          collection: 'docs',
          canonicalKey: 'docs:install',
          locale: 'en',
          path: '/docs/install',
          ref: 'docs.install',
          title: 'Install',
          order: 2
        },
        {
          collection: 'blog',
          canonicalKey: 'blog:release',
          locale: 'en',
          path: '/blog/release',
          ref: 'blog.release',
          title: 'Release',
          description: 'Release post',
          authors: ['authors.ada'],
          order: 1
        },
        {
          collection: 'blog',
          canonicalKey: 'blog:release',
          locale: 'de',
          path: '/blog/veroeffentlichung',
          ref: 'blog.release',
          title: 'Veroeffentlichung',
          description: 'Release auf Deutsch',
          authors: ['authors.ada'],
          order: 1
        },
        {
          collection: 'authors',
          canonicalKey: 'authors:ada',
          locale: 'en',
          path: '/authors/ada',
          ref: 'authors.ada',
          title: 'Ada',
          name: 'Ada'
        },
        {
          collection: 'authors',
          canonicalKey: 'authors:ada',
          locale: 'de',
          path: '/autoren/ada',
          ref: 'authors.ada',
          title: 'Ada',
          name: 'Ada'
        }
      ]
    })

    const provider = createFixtureContentProvider(fixture)
    const event = createProviderFixtureEvent({ fixture, provider })

    const page = unwrap(await provider.page?.(event, 'docs', '/de/dokumentation/start', {
      locale: 'de',
      fallback: true
    }))
    expect(page).toMatchObject({
      title: 'Startseite',
      path: '/de/dokumentation/start',
      resolved: { fallback: false },
      localePaths: {
        en: { path: '/docs/start' }
      }
    })

    const navigation = unwrap(await provider.navigation?.(event, 'docs', { locale: 'de' })) || []
    expect(navigation.map(item => item.path)).toEqual([
      '/de/dokumentation/install',
      '/de/dokumentation/start'
    ])

    const surroundings = unwrap(await provider.surroundings?.(event, 'docs', '/docs/start', { locale: 'en' })) || []
    expect(surroundings[0]).toMatchObject({ path: '/docs/install' })

    const posts = unwrap(await provider.query(event, {
      collection: 'blog',
      resolveLocale: { locale: 'de', fallback: false },
      only: ['title', 'authors', 'path', 'locale'],
      sort: [{ order: 1 }]
    }))
    expect(posts.result[0]).toMatchObject({
      title: 'Veroeffentlichung',
      authors: ['authors.ada']
    })

    const searchResults = unwrap(await provider.search?.(event, {
      term: 'veroeffentlichung',
      locale: 'de',
      collections: ['blog']
    })) || []
    expect(searchResults[0]).toMatchObject({
      path: '/de/blog/veroeffentlichung'
    })

    const routeMeta = unwrap(await provider.routeMeta?.(event, 'blog', '/de/blog/veroeffentlichung', { locale: 'de' }))
    expect(routeMeta).toMatchObject({
      path: '/de/blog/veroeffentlichung',
      localePaths: {
        de: { path: '/de/blog/veroeffentlichung' }
      }
    })

    const sitemapEntries = unwrap(await provider.sitemapEntries?.(event, { include: ['docs', 'blog'] })) || []
    expect(sitemapEntries).toEqual(expect.arrayContaining([
      { loc: '/de/dokumentation/start' },
      { loc: '/de/blog/veroeffentlichung' }
    ]))
    expect(JSON.stringify(sitemapEntries)).not.toContain('/authors/ada')

    await expect(provider.sitemapEntries?.(event, { include: ['authors'] })).rejects.toMatchObject({
      statusMessage: 'data_collection_sitemap_access',
      data: {
        code: 'data_collection_sitemap_access',
        collection: 'authors'
      }
    })

    const targets = createSitemapAssertionTargetsFromPrerenderedSitemaps([
      {
        name: '/sitemap.xml',
        content: [
          '<urlset>',
          '<url><loc>https://demo.ginko-content.dev/de/dokumentation/start</loc></url>',
          '<url><loc>https://demo.ginko-content.dev/de/blog/veroeffentlichung</loc></url>',
          '</urlset>'
        ].join('')
      }
    ])

    await expect(assertGeneratedSitemaps({
      options: normalizeContentSitemapAssertOptions({
        enabled: true,
        requiredPaths: ['/de/dokumentation/start', '/de/blog/veroeffentlichung'],
        forbiddenPathPrefixes: ['/authors'],
        requireProductionSiteUrl: true
      }),
      collectionRouteCounts: {
        docs: 2,
        blog: 1
      },
      targets
    })).resolves.toBeUndefined()
  })
})
