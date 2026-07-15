import { beforeEach, describe, expect, test, vi } from 'vitest'
import { projectSitemapEntry } from '../../packages/content/src/features/sitemap/query'
import { extractSitemapMetadata } from '../../packages/content/src/features/sitemap/metadata'
import { createEvent } from './_utils'

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
    state.runtime.collections = {
      docs: { i18n: { locales: ['en', 'de'], defaultLocale: 'en' } }
    }
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
    await expect(queryCollectionsSitemapEntries(createEvent(), {
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

  test('does not invent locale sitemap partitions for a non-localized collection', async () => {
    state.runtime.locales = []
    state.runtime.collections = { docs: {} }
    state.routes.mockReturnValue([
      { collection: 'docs', canonicalKey: 'intro', locale: 'en', contentPath: '/intro' }
    ])
    const { queryCollectionsSitemapEntries } = await import('../../packages/content/src/runtime/server/sitemap-provider')
    await expect(queryCollectionsSitemapEntries(createEvent(), {
      siteUrl: 'https://docs.example.test'
    })).resolves.toEqual([{ loc: '/intro' }])
  })

  test('applies collection, route, and draft policy after provider enumeration', async () => {
    state.runtime.collections = {
      docs: {},
      private: { sitemap: false },
      data: { type: 'data' }
    }
    state.routes.mockReturnValue([
      { collection: 'docs', canonicalKey: 'public', locale: 'en', contentPath: '/public' },
      { collection: 'docs', canonicalKey: 'draft', locale: 'en', contentPath: '/draft', draft: true },
      { collection: 'docs', canonicalKey: 'hidden', locale: 'en', contentPath: '/hidden', sitemap: false },
      { collection: 'private', canonicalKey: 'private', locale: 'en', contentPath: '/private' },
      { collection: 'data', canonicalKey: 'record', locale: 'en', contentPath: '/record' }
    ])
    const { queryCollectionsSitemapEntries } = await import('../../packages/content/src/runtime/server/sitemap-provider')
    await expect(queryCollectionsSitemapEntries(createEvent(), {
      siteUrl: 'https://docs.example.test'
    })).resolves.toEqual([{ loc: '/public' }])
    await expect(queryCollectionsSitemapEntries(createEvent(), {
      siteUrl: 'https://docs.example.test', includeDrafts: true, include: ['docs']
    })).resolves.toEqual([{ loc: '/public' }, { loc: '/draft' }])
    await expect(queryCollectionsSitemapEntries(createEvent(), {
      siteUrl: 'https://docs.example.test', include: ['private']
    })).rejects.toMatchObject({ statusMessage: 'data_collection_sitemap_access' })
  })
})
