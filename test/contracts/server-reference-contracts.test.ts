import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEvent, doc } from './_utils'

describe('server reference contracts', () => {
  const runtimeContent = {
    sources: {},
    defaultLocale: 'en',
    locales: ['en', 'de'],
    translatedSlugs: false,
    cacheVersion: 'v1',
    cacheIntegrity: 'integrity',
    ignores: [],
    localeFallback: { fr: ['de', 'en'], de: ['en'] },
    collections: {
      landing: {
        i18n: {
          defaultLocale: 'en',
          locales: ['en', 'de']
        }
      },
      docs: {
        i18n: {
          defaultLocale: 'en',
          locales: ['en', 'de']
        }
      },
      authors: {
        sitemap: false
      }
    }
  }

  const parsedCacheState = new Map<string, any>()
  const manifestCacheState = new Map<string, any>()
  const sourceItems = new Map<string, any>()
  const sourceMeta = new Map<string, any>()
  const docs = [
    doc({
      id: 'content:en:index.yml',
      file: { path: '/en/index.yml' },
      path: '/',
      type: 'yaml',
      collection: 'landing',
      canonicalKey: 'index',
      title: 'Home'
    }),
    doc({
      id: 'content:de:index.yml',
      file: { path: '/de/index.yml' },
      path: '/',
      locale: 'de',
      type: 'yaml',
      collection: 'landing',
      canonicalKey: 'index',
      title: 'Start'
    }),
    doc({
      id: 'content:en:guide:advanced.md',
      file: { path: '/en/guide/advanced.md' },
      path: '/guide/advanced',
      canonicalKey: 'guide/advanced',
      collection: 'docs',
      ref: 'guide/advanced',
      title: 'Advanced',
      image: {
        src: 'https://images.example.test/guide-advanced.png'
      }
    }),
    doc({
      id: 'content:de:guide:advanced.md',
      file: { path: '/de/guide/advanced.md' },
      path: '/leitfaden/fortgeschritten',
      locale: 'de',
      canonicalKey: 'guide/advanced',
      collection: 'docs',
      ref: 'guide/advanced',
      title: 'Fortgeschritten',
      image: {
        src: 'https://images.example.test/guide-advanced-de.png'
      }
    }),
    doc({
      id: 'content:en:authors:evan.yml',
      file: { path: '/authors/evan.yml' },
      path: '/authors/evan',
      type: 'yaml',
      collection: 'authors',
      canonicalKey: 'authors/evan',
      ref: 'evan',
      name: 'Evan'
    })
  ]

  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: {
        siteUrl: 'https://docs.example.test',
        i18n: {
          defaultLocale: 'en',
          locales: [
            { code: 'en', language: 'en-US' },
            { code: 'de', language: 'de-DE' }
          ]
        },
        content: {
          sitemap: {
            collections: ['docs']
          }
        }
      }
    }))
    parsedCacheState.clear()
    manifestCacheState.clear()
    sourceItems.clear()
    sourceMeta.clear()

    sourceItems.set('content:en:index.yml', 'title: Home')
    sourceItems.set('content:de:index.yml', 'title: Start')
    sourceItems.set('content:en:guide:advanced.md', '# Advanced')
    sourceItems.set('content:de:guide:advanced.md', '# Fortgeschritten')
    sourceItems.set('content:en:authors:evan.yml', 'name: Evan')
    sourceMeta.set('content:en:index.yml', { mtime: 1, size: 10 })
    sourceMeta.set('content:de:index.yml', { mtime: 1, size: 10 })
    sourceMeta.set('content:en:guide:advanced.md', { mtime: 1, size: 10 })
    sourceMeta.set('content:de:guide:advanced.md', { mtime: 1, size: 10 })
    sourceMeta.set('content:en:authors:evan.yml', { mtime: 1, size: 10 })

    vi.doMock('../../packages/content/src/integrations/nitro/runtime-config', () => ({
      getContentRuntimeConfig: () => ({ content: runtimeContent })
    }))
    vi.doMock('../../packages/content/src/integrations/nitro/storage', () => ({
      contentConfig: () => runtimeContent,
      contentIgnorePredicate: () => true,
      getContentsIds: vi.fn(async () => [
        'content:en:index.yml',
        'content:de:index.yml',
        'content:en:guide:advanced.md',
        'content:de:guide:advanced.md',
        'content:en:authors:evan.yml'
      ]),
      resolveStorageId: vi.fn(async (_event, id: string) => id),
      sourceStorage: () => ({
        async getItem(id: string) {
          return sourceItems.get(id) ?? null
        },
        async getMeta(id: string) {
          return sourceMeta.get(id) ?? { mtime: 0, size: 0 }
        }
      }),
      cacheParsedStorage: () => ({
        async getItem(id: string) {
          return parsedCacheState.get(id) ?? null
        },
        async setItem(id: string, value: any) {
          parsedCacheState.set(id, value)
        }
      }),
      cacheStorage: () => ({
        async getItem(id: string) {
          return manifestCacheState.get(id) ?? null
        },
        async setItem(id: string, value: any) {
          manifestCacheState.set(id, value)
        }
      })
    }))
    vi.doMock('../../packages/content/src/storage/cache', async () => {
      const actual = await vi.importActual<any>('../../packages/content/src/storage/cache')
      return {
        ...actual,
        cleanCachedContents: vi.fn(),
        getCachedContents: () => undefined,
        setCachedContents: vi.fn()
      }
    })
    vi.doMock('../../packages/content/src/integrations/nitro/ingest', () => ({
      parseContentVariants: vi.fn(async (id: string) => docs.filter(doc => doc.id === id)),
      parseContent: vi.fn()
    }))
    vi.doMock('../../packages/content/src/storage/validation', async () => {
      const actual = await vi.importActual<any>('../../packages/content/src/storage/validation')
      return {
        ...actual,
        // validateContentGraph returns Result<void, ContentError>; default to ok().
        validateContentGraph: vi.fn(() => ({ ok: true, value: undefined }))
      }
    })
    vi.doMock('../../packages/content/src/integrations/nitro/preview', () => ({
      isPreview: () => false
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  test('resolveContentReference handles exact and fallback locale semantics', async () => {
    const { resolveContentReference } = await import('../../packages/content/src/runtime/server/storage')

    await expect(resolveContentReference(createEvent(), 'guide/advanced', {
      locale: 'de',
      exact: true,
      collection: 'docs'
    })).resolves.toMatchObject({
      locale: 'de',
      resolved: {
        locale: 'de',
        fallback: false
      }
    })

    await expect(resolveContentReference(createEvent(), 'guide/advanced', {
      locale: 'fr',
      fallback: ['de', 'en'],
      collection: 'docs'
    })).resolves.toMatchObject({
      locale: 'de',
      resolved: {
        locale: 'de',
        fallback: true,
        variantPaths: {
          en: '/guide/advanced',
          de: '/leitfaden/fortgeschritten'
        }
      }
    })

    await expect(resolveContentReference(createEvent(), 'evan', {
      collection: 'authors'
    })).resolves.toMatchObject({
      canonicalKey: 'authors/evan'
    })

    await expect(resolveContentReference(createEvent(), 'missing/ref', {
      locale: 'de',
      collection: 'docs'
    })).resolves.toBeNull()
  })

  test('queryCollectionLocales resolves locale variants through the manifest', async () => {
    const { queryCollectionLocales } = await import('../../packages/content/src/runtime/server/storage')

    await expect(queryCollectionLocales(createEvent(), 'docs' as any, 'guide/advanced')).resolves.toEqual([
      { canonicalKey: 'guide/advanced', locale: 'de', path: '/leitfaden/fortgeschritten' },
      { canonicalKey: 'guide/advanced', locale: 'en', path: '/guide/advanced' }
    ])
  })

  test('serverQueryCollection supports explicit path filtering through where', async () => {
    const { serverQueryCollection } = await import('../../packages/content/src/runtime/server/provider-query')

    const query = serverQueryCollection(createEvent(), 'docs').where('path', '=', '/guide/advanced')

    expect(query.params()).toMatchObject({
      where: [
        { path: '/guide/advanced' },
        { draft: { $ne: true } },
        { locale: 'en' }
      ],
      collection: 'docs',
      sort: [{ 'file.stem': 1, $numeric: true }]
    })
  })

  test('serverQueryContent is not part of the public server API', async () => {
    const server = await import('../../packages/content/src/runtime/server/index')

    expect(server).not.toHaveProperty('serverQueryContent')
    expect(server).not.toHaveProperty('serverQueryCollection')
    expect(server).not.toHaveProperty('resolveContentReference')
    expect(server).not.toHaveProperty('queryCollectionLocales')
    expect(server).not.toHaveProperty('queryCollectionPage')
    expect(server).not.toHaveProperty('queryCollectionNavigation')
    expect(server).not.toHaveProperty('queryCollectionItemSurroundings')
    expect(server).not.toHaveProperty('queryCollectionRouteMeta')
    expect(server).not.toHaveProperty('queryCollectionSearchSections')
  })

  test('queryCollectionPage resolves the locale from a localized route path on the server', async () => {
    const { queryCollectionPage } = await import('../../packages/content/src/runtime/server/collection-helpers')

    await expect(queryCollectionPage(createEvent(), 'docs' as any, '/de/leitfaden/fortgeschritten')).resolves.toMatchObject({
      path: '/de/leitfaden/fortgeschritten',
      unprefixedPath: '/leitfaden/fortgeschritten',
      locale: 'de',
      localePaths: {
        // ADR-0016 changes the localePaths value shape from `string` to
        // `{ path, translated, fallback? }`.
        en: { path: '/guide/advanced', translated: true },
        de: { path: '/de/leitfaden/fortgeschritten', translated: true }
      }
    })
  })

  test('queryCollectionPage resolves non-markdown page variants through the route manifest', async () => {
    const { queryCollectionPage } = await import('../../packages/content/src/runtime/server/collection-helpers')

    await expect(queryCollectionPage(createEvent(), 'landing' as any, '/')).resolves.toMatchObject({
      path: '/',
      type: 'yaml',
      unprefixedPath: '/',
      locale: 'en',
      path: '/'
    })

    await expect(queryCollectionPage(createEvent(), 'landing' as any, '/de')).resolves.toMatchObject({
      path: '/',
      type: 'yaml',
      unprefixedPath: '/',
      locale: 'de',
      path: '/de'
    })
  })

  test('queryCollectionsSitemapEntries returns localized entries with alternates', async () => {
    const { queryCollectionsSitemapEntries } = await import('../../packages/content/src/runtime/server/sitemap')

    await expect(queryCollectionsSitemapEntries(createEvent(), {
      siteUrl: 'https://docs.example.test'
    })).resolves.toEqual([
      {
        _sitemap: 'en',
        loc: '/',
        alternatives: [
          { hreflang: 'x-default', href: 'https://docs.example.test/' },
          { hreflang: 'en', href: 'https://docs.example.test/' },
          { hreflang: 'de', href: 'https://docs.example.test/de' }
        ]
      },
      {
        _sitemap: 'de',
        loc: '/de',
        alternatives: [
          { hreflang: 'x-default', href: 'https://docs.example.test/' },
          { hreflang: 'en', href: 'https://docs.example.test/' },
          { hreflang: 'de', href: 'https://docs.example.test/de' }
        ]
      },
      {
        _sitemap: 'en',
        loc: '/guide/advanced',
        alternatives: [
          { hreflang: 'x-default', href: 'https://docs.example.test/guide/advanced' },
          { hreflang: 'en', href: 'https://docs.example.test/guide/advanced' },
          { hreflang: 'de', href: 'https://docs.example.test/de/leitfaden/fortgeschritten' }
        ],
        images: [
          { loc: 'https://images.example.test/guide-advanced.png' }
        ]
      },
      {
        _sitemap: 'de',
        loc: '/de/leitfaden/fortgeschritten',
        alternatives: [
          { hreflang: 'x-default', href: 'https://docs.example.test/guide/advanced' },
          { hreflang: 'en', href: 'https://docs.example.test/guide/advanced' },
          { hreflang: 'de', href: 'https://docs.example.test/de/leitfaden/fortgeschritten' }
        ],
        images: [
          { loc: 'https://images.example.test/guide-advanced-de.png' }
        ]
      }
    ])
  })
})
