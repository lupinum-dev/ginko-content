import { beforeEach, describe, expect, test, vi } from 'vitest'
import { projectSitemapEntry } from '../../packages/content/src/features/sitemap/query'
import { extractSitemapMetadata } from '../../packages/content/src/features/sitemap/metadata'
import { resolveLocalePolicy } from '../../packages/content/src/features/localization/locale-policy'
import { createTestEvent } from '../support/provider-scenarios/event'

const state = vi.hoisted(() => ({
  routes: vi.fn(),
  runtime: {
    defaultLocale: 'en',
    locales: ['en', 'de'],
    localeFallback: {},
    collections: {} as Record<string, any>
  },
  publicRuntime: {
    public: {
      i18n: {
        locales: [
          { code: 'en', language: 'en-US' },
          { code: 'de', language: 'de-DE' }
        ]
      }
    }
  }
}))

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: async () => ({
    name: 'fixture',
    capabilities: { query: { operators: [], pagination: [] } },
    query: vi.fn(),
    routes: async () => state.routes()
  })
}))

vi.mock('../../packages/content/src/runtime/server/runtime-config', () => ({
  getContentRuntimeConfig: () => ({ content: state.runtime })
}))

vi.mock('nitropack/runtime', () => ({
  useRuntimeConfig: () => state.publicRuntime
}))

const setRuntimeCollections = (collections: Record<string, any>) => {
  const localePolicy = resolveLocalePolicy({
    nuxtI18n: { installed: false },
    content: {
      locales: state.runtime.locales,
      defaultLocale: state.runtime.defaultLocale,
      fallback: state.runtime.localeFallback
    },
    collections: Object.entries(collections).map(([name, collection]) => ({
      name,
      localized: Boolean(collection.i18n),
      ...(collection.i18n && typeof collection.i18n === 'object'
        ? {
            locales: collection.i18n.locales,
            defaultLocale: collection.i18n.defaultLocale
          }
        : {}),
      route: collection.route
    }))
  })
  state.runtime.collections = Object.fromEntries(
    Object.entries(collections).map(([name, collection]) => [
      name,
      { ...collection, localePolicy: localePolicy.collections[name] }
    ])
  )
}

describe('provider-backed sitemap contracts', () => {
  beforeEach(() => {
    state.routes.mockReset()
    state.runtime.defaultLocale = 'en'
    state.runtime.locales = ['en', 'de']
    state.runtime.collections = {}
  })

  test('projects locale ownership and reciprocal alternates for Nuxt Sitemap sources', () => {
    const variants = [
      { locale: 'en', path: '/guide/intro' },
      { locale: 'de', path: '/de/leitfaden/einfuehrung' }
    ]
    const localeToLanguage = { en: 'en-US', de: 'de-DE' }

    expect(variants.map(variant => projectSitemapEntry({
      siteUrl: 'https://docs.example.test',
      defaultLocale: 'en',
      localeToLanguage,
      variant,
      variants
    }))).toEqual([
      {
        _sitemap: 'en-US',
        loc: '/guide/intro',
        alternatives: [
          { hreflang: 'x-default', href: 'https://docs.example.test/guide/intro' },
          { hreflang: 'en-US', href: 'https://docs.example.test/guide/intro' },
          { hreflang: 'de-DE', href: 'https://docs.example.test/de/leitfaden/einfuehrung' }
        ]
      },
      {
        _sitemap: 'de-DE',
        loc: '/de/leitfaden/einfuehrung',
        alternatives: [
          { hreflang: 'x-default', href: 'https://docs.example.test/guide/intro' },
          { hreflang: 'en-US', href: 'https://docs.example.test/guide/intro' },
          { hreflang: 'de-DE', href: 'https://docs.example.test/de/leitfaden/einfuehrung' }
        ]
      }
    ])
  })

  test('derives canonical route metadata from frontmatter and rendered content', () => {
    expect(extractSitemapMetadata({
      sitemap: {
        lastmod: '2026-07-15T08:00:00.000Z',
        images: [{ loc: '/images/frontmatter.png' }]
      },
      image: { src: '/images/hero.png' },
      body: {
        type: 'root',
        children: [{ tag: 'img', props: { src: '/images/body.png' } }]
      }
    })).toEqual({
      lastmod: '2026-07-15T08:00:00.000Z',
      images: [
        { loc: '/images/body.png' },
        { loc: '/images/frontmatter.png' },
        { loc: '/images/hero.png' }
      ]
    })
    expect(extractSitemapMetadata({ sitemap: false })).toBe(false)
  })

  test('preserves localized route metadata and expands relative images', async () => {
    setRuntimeCollections({
      docs: {
        i18n: { locales: ['en', 'de'], defaultLocale: 'en' },
        route: '/'
      }
    })
    state.routes.mockReturnValue([
      {
        collection: 'docs', canonicalKey: 'guide/intro', locale: 'en', contentPath: '/guide/intro',
        sitemap: {
          lastmod: '2026-07-15T08:00:00.000Z',
          images: [{ loc: '/images/intro.png' }]
        }
      },
      {
        collection: 'docs', canonicalKey: 'guide/intro', locale: 'de', contentPath: '/leitfaden/einfuehrung',
        sitemap: { images: [{ loc: 'https://cdn.example.test/intro-de.png' }] }
      }
    ])

    const { queryCollectionsSitemapEntries } = await import('../../packages/content/src/runtime/server/sitemap-provider')
    await expect(queryCollectionsSitemapEntries(createTestEvent(), {
      siteUrl: 'https://docs.example.test'
    })).resolves.toEqual([
      {
        _sitemap: 'en-US',
        loc: '/guide/intro',
        lastmod: '2026-07-15T08:00:00.000Z',
        images: [{ loc: 'https://docs.example.test/images/intro.png' }],
        alternatives: [
          { hreflang: 'x-default', href: 'https://docs.example.test/guide/intro' },
          { hreflang: 'en-US', href: 'https://docs.example.test/guide/intro' },
          { hreflang: 'de-DE', href: 'https://docs.example.test/de/leitfaden/einfuehrung' }
        ]
      },
      {
        _sitemap: 'de-DE',
        loc: '/de/leitfaden/einfuehrung',
        images: [{ loc: 'https://cdn.example.test/intro-de.png' }],
        alternatives: [
          { hreflang: 'x-default', href: 'https://docs.example.test/guide/intro' },
          { hreflang: 'en-US', href: 'https://docs.example.test/guide/intro' },
          { hreflang: 'de-DE', href: 'https://docs.example.test/de/leitfaden/einfuehrung' }
        ]
      }
    ])
  })

  test('inherits the global locale policy when the collection opts in', async () => {
    setRuntimeCollections({
      docs: {
        i18n: true,
        route: { en: '/docs', de: '/dokumentation' }
      }
    })
    state.routes.mockReturnValue([
      {
        collection: 'docs',
        canonicalKey: 'provider-guide',
        locale: 'en',
        contentPath: '/docs/provider-guide'
      },
      {
        collection: 'docs',
        canonicalKey: 'provider-guide',
        locale: 'de',
        contentPath: '/dokumentation/provider-leitfaden'
      }
    ])

    const { queryCollectionsSitemapEntries } = await import('../../packages/content/src/runtime/server/sitemap-provider')
    const entries = await queryCollectionsSitemapEntries(createTestEvent(), {
      siteUrl: 'https://docs.example.test'
    })

    expect(entries).toEqual([
      expect.objectContaining({
        _sitemap: 'en-US',
        alternatives: expect.arrayContaining([
          { hreflang: 'en-US', href: 'https://docs.example.test/docs/provider-guide' },
          { hreflang: 'de-DE', href: 'https://docs.example.test/de/dokumentation/provider-leitfaden' }
        ])
      }),
      expect.objectContaining({
        _sitemap: 'de-DE',
        alternatives: expect.arrayContaining([
          { hreflang: 'en-US', href: 'https://docs.example.test/docs/provider-guide' },
          { hreflang: 'de-DE', href: 'https://docs.example.test/de/dokumentation/provider-leitfaden' }
        ])
      })
    ])
  })

  test('does not infer localization from provider locale facts when the collection disables i18n', async () => {
    setRuntimeCollections({ docs: { i18n: false, route: '/' } })
    state.routes.mockReturnValue([{
      collection: 'docs',
      canonicalKey: 'provider-guide',
      locale: 'en',
      contentPath: '/provider-guide'
    }])

    const { queryCollectionsSitemapEntries } = await import('../../packages/content/src/runtime/server/sitemap-provider')
    await expect(queryCollectionsSitemapEntries(createTestEvent(), {
      siteUrl: 'https://docs.example.test'
    })).resolves.toEqual([{ loc: '/provider-guide' }])
  })

  test('keeps collection and canonical identities distinct when either contains a colon', async () => {
    setRuntimeCollections({
      'a:b': { i18n: true, route: '/' },
      a: { i18n: true, route: '/' }
    })
    state.routes.mockReturnValue([
      { collection: 'a:b', canonicalKey: 'c', locale: 'en', contentPath: '/first' },
      { collection: 'a', canonicalKey: 'b:c', locale: 'de', contentPath: '/second' }
    ])

    const { queryCollectionsSitemapEntries } = await import('../../packages/content/src/runtime/server/sitemap-provider')
    await expect(queryCollectionsSitemapEntries(createTestEvent(), {
      siteUrl: 'https://docs.example.test'
    })).resolves.toEqual([
      { _sitemap: 'en-US', loc: '/first' },
      { _sitemap: 'de-DE', loc: '/de/second' }
    ])
  })

  test('does not invent locale sitemap partitions for a non-localized collection', async () => {
    state.runtime.locales = []
    setRuntimeCollections({ docs: { route: '/' } })
    state.routes.mockReturnValue([
      { collection: 'docs', canonicalKey: 'intro', locale: 'en', contentPath: '/intro' }
    ])
    const { queryCollectionsSitemapEntries } = await import('../../packages/content/src/runtime/server/sitemap-provider')
    await expect(queryCollectionsSitemapEntries(createTestEvent(), {
      siteUrl: 'https://docs.example.test'
    })).resolves.toEqual([{ loc: '/intro' }])
  })

  test('applies collection, route, and draft policy after provider enumeration', async () => {
    setRuntimeCollections({
      docs: { i18n: true, route: '/' },
      private: { sitemap: false, route: '/' },
      data: { type: 'data', route: '/' }
    })
    state.routes.mockReturnValue([
      { collection: 'docs', canonicalKey: 'public', locale: 'en', contentPath: '/public' },
      { collection: 'docs', canonicalKey: 'draft', locale: 'en', contentPath: '/draft', draft: true },
      { collection: 'docs', canonicalKey: 'hidden', locale: 'en', contentPath: '/hidden', sitemap: false },
      { collection: 'private', canonicalKey: 'private', locale: 'en', contentPath: '/private' },
      { collection: 'data', canonicalKey: 'record', locale: 'en', contentPath: '/record' }
    ])
    const { queryCollectionsSitemapEntries } = await import('../../packages/content/src/runtime/server/sitemap-provider')
    await expect(queryCollectionsSitemapEntries(createTestEvent(), {
      siteUrl: 'https://docs.example.test'
    })).resolves.toEqual([{ _sitemap: 'en-US', loc: '/public' }])
    await expect(queryCollectionsSitemapEntries(createTestEvent(), {
      siteUrl: 'https://docs.example.test', includeDrafts: true, include: ['docs']
    })).resolves.toEqual([
      { _sitemap: 'en-US', loc: '/public' },
      { _sitemap: 'en-US', loc: '/draft' }
    ])
    await expect(queryCollectionsSitemapEntries(createTestEvent(), {
      siteUrl: 'https://docs.example.test', include: ['private']
    })).rejects.toMatchObject({ statusMessage: 'data_collection_sitemap_access' })
  })

  test('rejects provider routes for collections absent from runtime configuration', async () => {
    setRuntimeCollections({ docs: { route: '/' } })
    state.routes.mockReturnValue([
      { collection: 'secret', canonicalKey: 'secret:leak', locale: 'en', contentPath: '/secret/leak' }
    ])

    const { queryCollectionsSitemapEntries } = await import('../../packages/content/src/runtime/server/sitemap-provider')
    await expect(queryCollectionsSitemapEntries(createTestEvent(), {
      siteUrl: 'https://docs.example.test'
    })).rejects.toMatchObject({
      statusMessage: 'provider_result_invalid',
      data: expect.objectContaining({ operation: 'routes', field: 'result[0].collection' })
    })
  })
})
