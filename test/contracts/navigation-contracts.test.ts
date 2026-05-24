import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEvent, createStorage, doc, navDoc } from './_utils'

const runtimeConfig = {
  public: { content: { navigation: { fields: ['icon', 'badge'] } } },
  content: { defaultLocale: 'en', localeFallback: { de: ['fr'] } }
}

const cache = createStorage()
const createServerContentQuery = vi.fn()
const serverQueryCollection = vi.fn()
const getContent = vi.fn()
const resolveLocaleChain = vi.fn()
const resolveVariant = vi.fn()
const isPreview = vi.fn()

describe('navigation contracts', () => {
  beforeEach(() => {
    vi.resetModules()
    cache._state.clear()
    createServerContentQuery.mockReset()
    serverQueryCollection.mockReset()
    getContent.mockReset()
    resolveLocaleChain.mockReset()
    resolveVariant.mockReset()
    isPreview.mockReset()
    isPreview.mockReturnValue(false)
    delete (runtimeConfig.content as any).collections

    vi.doMock('../../packages/content/src/runtime/server/runtime-config', () => ({
      getContentRuntimeConfig: () => runtimeConfig
    }))
    vi.doMock('../../packages/content/src/runtime/server/storage', () => ({
      createServerContentQuery,
      serverQueryCollection
    }))
    vi.doMock('../../packages/content/src/storage/contents', () => ({
      getContent
    }))
    vi.doMock('../../packages/content/src/integrations/nitro/ingest', () => ({
      parseContentVariants: vi.fn(),
      parseContent: vi.fn()
    }))
    vi.doMock('../../packages/content/src/integrations/nitro/storage', () => ({
      cacheStorage: () => cache,
      contentConfig: () => ({
        locales: [],
        defaultLocale: '',
        localeFallback: {},
        translatedSlugs: false
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/manifest', () => ({
      resolveLocaleChain,
      resolveVariant
    }))
    vi.doMock('../../packages/content/src/integrations/nitro/preview', () => ({
      isPreview
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('createContentSearchNavigation exposes parent pages as search leaves without mutating source navigation', async () => {
    const { createContentSearchNavigation } = await import('../../packages/content/src/features/search/navigation')
    const navigation = [
      {
        title: 'Guide',
        path: '/guide',
        children: [
          { title: 'Intro', path: '/guide/intro' },
          {
            title: 'Advanced',
            path: '/guide/advanced',
            children: [
              { title: 'Deep Dive', path: '/guide/advanced/deep-dive' }
            ]
          }
        ]
      }
    ] as any[]

    const result = createContentSearchNavigation(navigation)

    expect(result).toEqual([
      expect.objectContaining({
        title: 'Guide',
        path: '/guide',
        children: [
          expect.objectContaining({ title: 'Guide', path: '/guide', children: undefined }),
          expect.objectContaining({ title: 'Intro', path: '/guide/intro', children: undefined }),
          expect.objectContaining({
            title: 'Advanced',
            path: '/guide/advanced',
            children: [
              expect.objectContaining({ title: 'Advanced', path: '/guide/advanced', children: undefined }),
              expect.objectContaining({ title: 'Deep Dive', path: '/guide/advanced/deep-dive', children: undefined })
            ]
          })
        ]
      })
    ])
    expect(navigation[0]!.children).toHaveLength(2)
    expect(navigation[0]!.children![1]!.children).toHaveLength(1)
  })

  test('createContentSearchNavigation supports single-locale pathless locale metadata', async () => {
    const { createContentSearchNavigation } = await import('../../packages/content/src/features/search/navigation')
    const result = createContentSearchNavigation([
      {
        title: 'Docs',
        _path: '/docs',
        children: [
          { title: 'Install', _path: '/docs/install' }
        ]
      }
    ] as any[])

    expect(result[0]).toEqual(expect.objectContaining({
      title: 'Docs',
      _path: '/docs',
      path: '/docs',
      children: [
        expect.objectContaining({ title: 'Docs', _path: '/docs', path: '/docs', children: undefined }),
        expect.objectContaining({ title: 'Install', _path: '/docs/install', path: '/docs/install', children: undefined })
      ]
    }))
  })

  test('createContentSearchNavigation gives root pathless search groups an id without fake page leaves', async () => {
    const { createContentSearchNavigation } = await import('../../packages/content/src/features/search/navigation')
    const result = createContentSearchNavigation([
      {
        title: 'Dokumentation',
        children: [
          {
            title: 'Einfuehrung',
            path: '/de/dokumentation/erste-schritte',
            children: [
              { title: 'Installation', path: '/de/dokumentation/erste-schritte/installation' }
            ]
          },
          {
            title: 'Grundlagen',
            children: [
              { title: 'Markdown Syntax', path: '/de/dokumentation/grundlagen/markdown-syntax' }
            ]
          }
        ]
      }
    ] as any[])

    expect(result[0]).toEqual(expect.objectContaining({
      title: 'Dokumentation',
      searchGroupId: 'content-search-group:0:0',
      children: [
        expect.objectContaining({
          title: 'Einfuehrung',
          path: '/de/dokumentation/erste-schritte',
          children: [
            expect.objectContaining({
              title: 'Einfuehrung',
              path: '/de/dokumentation/erste-schritte',
              children: undefined
            }),
            expect.objectContaining({
              title: 'Installation',
              path: '/de/dokumentation/erste-schritte/installation',
              children: undefined
            })
          ]
        }),
        expect.objectContaining({
          title: 'Grundlagen',
          searchGroupId: 'content-search-group:1:1',
          children: [
            expect.objectContaining({
              title: 'Markdown Syntax',
              path: '/de/dokumentation/grundlagen/markdown-syntax',
              children: undefined
            })
          ]
        })
      ]
    }))
    expect(result[0]).not.toHaveProperty('path')
    expect(result[0]!.children![1]).not.toHaveProperty('path')
    expect(result[0]!.children).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Dokumentation',
        children: undefined
      })
    ]))
    expect(result[0]!.children![1]!.children).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Grundlagen',
        children: undefined
      })
    ]))
  })

  test('navigation resolver helpers resolve common docs links without mutating source navigation', async () => {
    const {
      findFirstNavigationChild,
      findFirstNavigationPage,
      findNavigationItem,
      resolveNavigationFirstChildren,
      resolveNavigationFirstPages,
      resolveNavigationPaths
    } = await import('../../packages/content/src/features/navigation/resolve')
    const navigation = [
      {
        title: 'Guides',
        page: false,
        children: [
          { title: 'Intro', path: '/docs/intro', _path: '/docs/intro', stem: 'docs/intro' },
          { title: 'Setup', path: '/docs/setup', _path: '/docs/setup', stem: 'docs/setup' }
        ]
      },
      {
        title: 'API',
        path: '/docs/api',
        _path: '/docs/api',
        canonicalPath: '/api',
        stem: 'docs/api',
        children: [
          { title: 'Composables', path: '/docs/api/composables', _path: '/docs/api/composables', stem: 'docs/api/composables' }
        ]
      }
    ] as any[]

    const firstPage = findFirstNavigationPage(navigation)
    const api = findNavigationItem(navigation, 'API')
    const byCanonicalPath = findNavigationItem(navigation, '/api')
    const byStem = findNavigationItem(navigation, { stem: 'docs/api' })

    expect(firstPage).toEqual(expect.objectContaining({ title: 'Intro', path: '/docs/intro' }))
    expect(findFirstNavigationChild(api)).toEqual(expect.objectContaining({ title: 'Composables', path: '/docs/api/composables' }))
    expect(byCanonicalPath).toBe(api)
    expect(byStem).toBe(api)
    expect(resolveNavigationPaths(navigation)).toEqual(['/docs/api'])
    expect(resolveNavigationFirstPages(navigation).map(item => item.path)).toEqual(['/docs/intro', '/docs/api'])
    expect(resolveNavigationFirstChildren(navigation).map(item => item.path)).toEqual(['/docs/intro', '/docs/api/composables'])
    expect(navigation[0]!.children).toHaveLength(2)
  })

  test('navigation resolver helpers handle empty navigation consistently', async () => {
    const {
      findFirstNavigationChild,
      findFirstNavigationPage,
      findNavigationItem,
      resolveNavigationFirstChildren,
      resolveNavigationFirstPages,
      resolveNavigationPaths
    } = await import('../../packages/content/src/features/navigation/resolve')

    expect(findFirstNavigationPage([])).toBeNull()
    expect(findNavigationItem([], 0)).toBeNull()
    expect(findFirstNavigationChild(null)).toBeNull()
    expect(resolveNavigationPaths([])).toEqual([])
    expect(resolveNavigationFirstPages([])).toEqual([])
    expect(resolveNavigationFirstChildren([])).toEqual([])
  })

  test('createNav builds deterministic trees from index pages and folder metadata', async () => {
    const { createNav } = await import('../../packages/content/src/runtime/server/navigation')

    const nav = createNav([
      navDoc({ _file: '/en/2.guide/index.md', _path: '/guide', title: 'Guide' }),
      doc({ _id: 'content:en:2.guide:1.intro.md', _file: '/en/2.guide/1.intro.md', _path: '/guide/intro', _canonicalKey: 'guide/intro', title: 'Intro', _locale: 'en' }),
      doc({ _id: 'content:en:2.guide:2.advanced.md', _file: '/en/2.guide/2.advanced.md', _path: '/guide/advanced', _canonicalKey: 'guide/advanced', title: 'Advanced', _locale: 'en' }),
      navDoc({ _id: 'content:en:3.hidden:index.md', _file: '/en/3.hidden/index.md', _path: '/hidden', title: 'Hidden' }),
      doc({ _id: 'content:en:3.hidden:1.secret.md', _file: '/en/3.hidden/1.secret.md', _path: '/hidden/secret', title: 'Secret' }),
      navDoc({ _id: 'content:de:2.leitfaden:index.md', _file: '/de/2.leitfaden/index.md', _path: '/leitfaden', _locale: 'de', _canonicalKey: 'guide', title: 'Leitfaden' })
    ] as any, {
      '/guide': { title: 'Guides', icon: 'i-guide', badge: 'Hot' } as any,
      '/hidden': { navigation: false } as any
    })

    expect(nav).toHaveLength(2)
    expect(nav).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Guides',
        _path: '/guide',
        _canonicalKey: 'guide',
        _locale: 'en',
        icon: 'i-guide',
        badge: 'Hot',
        children: [
          expect.objectContaining({ title: 'Intro', _path: '/guide/intro', _canonicalKey: 'guide/intro', _locale: 'en' }),
          expect.objectContaining({ title: 'Advanced', _path: '/guide/advanced', _canonicalKey: 'guide/advanced', _locale: 'en' })
        ]
      }),
      expect.objectContaining({
        title: 'Leitfaden',
        _path: '/leitfaden',
        _canonicalKey: 'guide',
        _locale: 'de'
      })
    ]))
  })

  test('resolveContentNavigation merges locale fallbacks, localizes variants, and avoids duplicates', async () => {
    const docsByLocale: Record<string, any[]> = {
      de: [
        navDoc({ _id: 'content:de:guide:index.md', _file: '/de/guide/index.md', _path: '/leitfaden', _locale: 'de', _canonicalKey: 'guide', title: 'Leitfaden' }),
        doc({ _id: 'content:de:guide:intro.md', _file: '/de/guide/intro.md', _path: '/leitfaden/einstieg', _locale: 'de', _canonicalKey: 'guide/intro', title: 'Einstieg' })
      ],
      en: [
        navDoc({ _id: 'content:en:guide:index.md', _file: '/en/guide/index.md', _path: '/guide', _locale: 'en', _canonicalKey: 'guide', title: 'Guide' }),
        doc({ _id: 'content:en:guide:intro.md', _file: '/en/guide/intro.md', _path: '/guide/intro', _locale: 'en', _canonicalKey: 'guide/intro', title: 'Intro' }),
        doc({ _id: 'content:en:guide:advanced.md', _file: '/en/guide/advanced.md', _path: '/guide/advanced', _locale: 'en', _canonicalKey: 'guide/advanced', title: 'Advanced' })
      ]
    }
    const dirConfigsByLocale: Record<string, any[]> = {
      de: [],
      en: []
    }

    createServerContentQuery.mockImplementation((_event, _query = {}) => {
      const wheres: any[] = []
      return {
        where(where: any, operator?: any, value?: any) {
          wheres.push(operator ? { [where]: value } : where)
          return this
        },
        all: async function () {
          const locale = wheres.find(where => typeof where._locale !== 'undefined')?._locale
          const navigationQuery = wheres.some(where => where._navigation)
          return navigationQuery ? (dirConfigsByLocale[locale || 'en'] || []) : (docsByLocale[locale || 'en'] || [])
        },
        find() {
          return this.all()
        }
      }
    })
    resolveLocaleChain.mockReturnValue(['de', 'en'])

    const { resolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    const nav = await resolveContentNavigation(createEvent(), {
      resolveLocale: { locale: 'de', fallback: true }
    })

    expect(resolveLocaleChain).toHaveBeenCalledWith('de', 'en', { de: ['fr', 'en'] })

    expect(nav).toEqual([
      expect.objectContaining({
        title: 'Leitfaden',
        _path: '/leitfaden',
        _id: 'content:de:guide:index.md',
        _canonicalKey: 'guide',
        _locale: 'de',
        _fallback: false,
        children: [
          expect.objectContaining({
            title: 'Einstieg',
            _path: '/leitfaden/einstieg',
            _locale: 'de',
            _fallback: false
          }),
          expect.objectContaining({
            title: 'Advanced',
            _path: '/guide/advanced',
            path: '/de/guide/advanced',
            _locale: 'en',
            _fallback: true
          })
        ]
      })
    ])
    expect(nav[0]!.children).toHaveLength(2)
  })

  test('resolveContentNavigation merges synthetic translated folder roots before collection unwrapping', async () => {
    ;(runtimeConfig.content as any).collections = {
      docs: {
        i18n: { locales: ['en', 'de'], defaultLocale: 'en' },
        route: { en: '/docs', de: '/dokumentation' }
      }
    }

    const docsByLocale: Record<string, any[]> = {
      de: [
        doc({ _id: 'content:de:docs:getting-started:index.md', _file: '/de/1.dokumentation/1.erste-schritte/index.md', _path: '/dokumentation/erste-schritte', _locale: 'de', _canonicalKey: 'docs/getting-started', title: 'Einfuehrung' }),
        doc({ _id: 'content:de:docs:getting-started:installation.md', _file: '/de/1.dokumentation/1.erste-schritte/installation.md', _path: '/dokumentation/erste-schritte/installation', _locale: 'de', _canonicalKey: 'docs/getting-started/installation', title: 'Installation' }),
        doc({ _id: 'content:de:docs:essentials:markdown.md', _file: '/de/1.dokumentation/2.grundlagen/markdown-syntax.md', _path: '/dokumentation/grundlagen/markdown-syntax', _locale: 'de', _canonicalKey: 'docs/essentials/markdown-syntax', title: 'Markdown Syntax' })
      ],
      en: [
        doc({ _id: 'content:en:docs:getting-started:index.md', _file: '/en/1.docs/1.getting-started/index.md', _path: '/docs/getting-started', _locale: 'en', _canonicalKey: 'docs/getting-started', title: 'Introduction' }),
        doc({ _id: 'content:en:docs:getting-started:usage.md', _file: '/en/1.docs/1.getting-started/usage.md', _path: '/docs/getting-started/usage', _locale: 'en', _canonicalKey: 'docs/getting-started/usage', title: 'Usage' }),
        doc({ _id: 'content:en:docs:essentials:fallback-lab.md', _file: '/en/1.docs/2.essentials/fallback-lab.md', _path: '/docs/essentials/fallback-lab', _locale: 'en', _canonicalKey: 'docs/essentials/fallback-lab', title: 'Fallback Lab' })
      ]
    }

    createServerContentQuery.mockImplementation((_event, _query = {}) => {
      const wheres: any[] = []
      return {
        where(field: any, operator?: any, value?: any) {
          wheres.push(operator ? { [field]: value } : field)
          return this
        },
        async all() {
          const locale = wheres.find(where => typeof where._locale !== 'undefined')?._locale
          const navigationQuery = wheres.some(where => where._navigation)
          return navigationQuery ? [] : (docsByLocale[locale || 'en'] || [])
        },
        find() {
          return this.all()
        }
      }
    })
    resolveLocaleChain.mockReturnValue(['de', 'en'])

    const { resolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    const nav = await resolveContentNavigation(createEvent(), {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: true }
    })

    expect(nav.map(item => item.title)).toEqual(['Einfuehrung', 'Grundlagen'])
    expect(nav).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Docs' }),
      expect.objectContaining({ title: 'Introduction' }),
      expect.objectContaining({ title: 'Essentials' })
    ]))
    expect(nav[0]!.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Installation', _locale: 'de', _fallback: false }),
      expect.objectContaining({ title: 'Usage', _locale: 'en', _fallback: true })
    ]))
    expect(nav[1]!.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Markdown Syntax', _locale: 'de', _fallback: false }),
      expect.objectContaining({ title: 'Fallback Lab', _locale: 'en', _fallback: true })
    ]))

    delete (runtimeConfig.content as any).collections
  })

  test('resolveContentNavigation does not derive fallback locale from grouped where clauses', async () => {
    createServerContentQuery.mockImplementation((_event, _query = {}) => {
      const wheres: any[] = []
      return {
        where(field: any, operator?: any, value?: any) {
          wheres.push(operator ? { [field]: value } : field)
          return this
        },
        async all() {
          const locale = wheres.find(where => typeof where._locale !== 'undefined')?._locale
          return locale === 'de'
            ? [navDoc({ _id: 'content:de:guide:index.md', _file: '/de/guide/index.md', _path: '/leitfaden', _locale: 'de', _canonicalKey: 'guide', title: 'Leitfaden' })]
            : [navDoc({ _id: 'content:en:guide:index.md', _file: '/en/guide/index.md', _path: '/guide', _locale: 'en', _canonicalKey: 'guide', title: 'Guide' })]
        },
        find() {
          return this.all()
        }
      }
    })

    const { resolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    const nav = await resolveContentNavigation(createEvent(), {
      where: [{ $and: [{ _locale: 'de' }, { featured: true }] }]
    } as any)

    expect(resolveLocaleChain).not.toHaveBeenCalled()
    expect(nav).toEqual([
      expect.objectContaining({
        title: 'Guide',
        _locale: 'en'
      })
    ])
  })

  test('resolveContentNavigation preserves locale filters across immutable query-builder chains', async () => {
    const allWheres: any[][] = []
    const createBuilder = (wheres: any[] = []): any => ({
      where(field: any, operator?: any, value?: any) {
        return createBuilder([...wheres, operator ? { [field]: value } : field])
      },
      async all() {
        allWheres.push(wheres)
        return []
      },
      find() {
        return this.all()
      }
    })
    createServerContentQuery.mockImplementation(() => createBuilder())
    resolveLocaleChain.mockReturnValue(['de'])

    const { resolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    await resolveContentNavigation(createEvent(), {
      resolveLocale: { locale: 'de', exact: true }
    })

    expect(allWheres).toHaveLength(2)
    expect(allWheres[0]).toEqual(expect.arrayContaining([{ _locale: 'de' }]))
    expect(allWheres[1]).toEqual(expect.arrayContaining([{ _locale: 'de' }]))
  })

  test('resolveContentNavigation reads cached nav only for the empty non-preview path', async () => {
    cache._state.set('_nav.json', [{ title: 'Cached', _path: '/cached' }] as any)
    createServerContentQuery.mockImplementation(() => ({
      where() {
        return this
      },
      async all() {
        return []
      },
      find() {
        return this.all()
      }
    }))

    const { resolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')

    await expect(resolveContentNavigation(createEvent())).resolves.toEqual([{ title: 'Cached', _path: '/cached' }])
    expect(createServerContentQuery).not.toHaveBeenCalled()

    await resolveContentNavigation(createEvent(), { where: [{ _locale: 'de' }] })
    expect(createServerContentQuery).toHaveBeenCalled()
  })

  test('resolveContentNavigation unwraps a synthetic collection root for collection-scoped queries', async () => {
    createServerContentQuery.mockImplementation((_event, query = {}) => {
      const isDirConfigQuery = query && Object.keys(query).length === 0
      return {
        where() {
          return this
        },
        async all() {
          if (isDirConfigQuery) {
            return []
          }

          return [
            navDoc({ _id: 'content:docs:index.md', _file: '/docs/index.md', _path: '/docs', title: 'Docs' }),
            doc({ _id: 'content:docs:getting-started:index.md', _file: '/docs/getting-started/index.md', _path: '/docs/getting-started', title: 'Getting Started' })
          ]
        },
        find() {
          return this.all()
        }
      }
    })

    const { resolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    const nav = await resolveContentNavigation(createEvent(), { collection: 'docs' })

    expect(nav).toEqual([
      expect.objectContaining({
        title: 'Getting Started',
        _path: '/docs/getting-started'
      })
    ])
  })

  test('server queryCollectionNavigation unwraps a synthetic collection root by default', async () => {
    const event = createEvent()
    serverQueryCollection.mockImplementation(() => ({
      select() {
        return this
      },
      async all() {
        return []
      },
      find() {
        return this.all()
      }
    }))
    const resolveContentNavigation = vi.fn(async () => [
      { title: 'Guide', _path: '/guide', path: '/guide' }
    ])
    vi.doMock('../../packages/content/src/runtime/server/navigation-query', () => ({
      resolveContentNavigation
    }))

    const { queryCollectionNavigation } = await import('../../packages/content/src/runtime/server/collection-helpers')
    const nav = await queryCollectionNavigation(event, 'docs')

    expect(nav).toEqual([
      expect.objectContaining({
        title: 'Guide',
        _path: '/guide',
        path: '/guide'
      })
    ])
    expect(resolveContentNavigation).toHaveBeenCalledWith(event, { collection: 'docs' })
  })

  test('server queryCollectionItemSurroundings forwards locale and canonical options to navigation loading', async () => {
    vi.resetModules()
    const resolveCollectionNavigationData = vi.fn(async (_collection, _runtime, options) => options)
    const resolveCollectionItemSurroundingsData = vi.fn(async (_collection, _path, _runtime, options) => {
      return await options.loadNavigation({
        fields: ['badge'],
        locale: 'de',
        canonical: true
      })
    })

    vi.doMock('../../packages/content/src/features/collections/resolve', () => ({
      resolveCollectionNavigationData,
      resolveCollectionItemSurroundingsData,
      resolveCollectionPageData: vi.fn(),
      resolveCollectionRouteMetaData: vi.fn(),
      resolveCollectionSearchSectionsData: vi.fn()
    }))
    vi.doMock('../../packages/content/src/runtime/server/navigation-query', () => ({
      resolveContentNavigation: vi.fn(async () => [])
    }))
    vi.doMock('../../packages/content/src/runtime/server/storage', () => ({
      serverQueryCollection: vi.fn(() => ({
        select() {
          return this
        },
        async all() {
          return []
        },
        find() {
          return this.all()
        }
      }))
    }))
    vi.doMock('../../packages/content/src/integrations/nitro/storage', () => ({
      contentConfig: () => ({
        locales: ['en', 'de'],
        defaultLocale: 'en',
        localeFallback: { de: ['en'] },
        translatedSlugs: false
      })
    }))

    const { queryCollectionItemSurroundings } = await import('../../packages/content/src/runtime/server/collection-helpers')

    const forwarded = await queryCollectionItemSurroundings(createEvent(), 'docs', '/de/leitfaden/einstieg', {
      fields: ['badge'],
      locale: 'de',
      canonical: true
    })

    expect(resolveCollectionItemSurroundingsData).toHaveBeenCalledTimes(1)
    expect(resolveCollectionNavigationData).toHaveBeenCalledTimes(1)
    expect(forwarded).toMatchObject({
      fields: ['badge'],
      locale: 'de',
      canonical: true
    })
  })
})
