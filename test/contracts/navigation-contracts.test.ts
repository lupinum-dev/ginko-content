import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEvent, createStorage, doc, navDoc } from './_utils'
import { toContentProviderNavigationQuery } from '../../packages/content/src/public/provider-query'

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
    vi.doMock('../../packages/content/src/storage/graph', () => ({
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
    ]

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
        path: '/docs',
        children: [
          { title: 'Install', path: '/docs/install' }
        ]
      }
    ])

    expect(result[0]).toEqual(expect.objectContaining({
      title: 'Docs',
      path: '/docs',
      children: [
        expect.objectContaining({ title: 'Docs', path: '/docs', children: undefined }),
        expect.objectContaining({ title: 'Install', path: '/docs/install', children: undefined })
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
          { title: 'Intro', path: '/docs/intro', stem: 'docs/intro' },
          { title: 'Setup', path: '/docs/setup', stem: 'docs/setup' }
        ]
      },
      {
        title: 'API',
        path: '/docs/api',
        unprefixedPath: '/api',
        stem: 'docs/api',
        children: [
          { title: 'Composables', path: '/docs/api/composables', stem: 'docs/api/composables' }
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

  test('findFirstNavigationPage resolves structural trees without mutating them', async () => {
    const { findFirstNavigationPage } = await import('../../packages/content/src/features/navigation/resolve')
    const navigation = [
      {
        title: 'Structural section',
        page: false as const,
        path: '/must-not-win',
        children: [
          {
            title: 'Nested group',
            children: [
              { title: 'Deep page', path: '/docs/deep', badge: 'new' }
            ]
          }
        ]
      },
      { title: 'Later page', path: '/docs/later' }
    ]
    const before = structuredClone(navigation)

    expect(findFirstNavigationPage(navigation)).toEqual(expect.objectContaining({
      title: 'Deep page',
      path: '/docs/deep',
      badge: 'new'
    }))
    expect(navigation).toEqual(before)
    expect(findFirstNavigationPage([{ title: 'Section index', path: '/docs/section', children: [{ title: 'Child', path: '/docs/section/child' }] }])).toEqual(expect.objectContaining({ path: '/docs/section' }))
    expect(findFirstNavigationPage([{ title: 'Empty path', path: '' }, { title: 'Page', path: '/docs/page' }])).toEqual(expect.objectContaining({ path: '/docs/page' }))
    expect(findFirstNavigationPage([{ title: 'Group', children: [{ title: 'Nested group' }] }])).toBeNull()
    expect(findFirstNavigationPage(undefined)).toBeNull()
  })

  test('buildNavigation builds deterministic trees from index pages and folder metadata', async () => {
    const { buildNavigation } = await import('../../packages/content/src/features/navigation/build')

    const nav = buildNavigation([
      navDoc({ file: { path: '/en/2.guide/index.md' }, path: '/guide', title: 'Guide' }),
      doc({ id: 'content:en:2.guide:1.intro.md', file: { path: '/en/2.guide/1.intro.md' }, path: '/guide/intro', canonicalKey: 'guide/intro', title: 'Intro', locale: 'en' }),
      doc({ id: 'content:en:2.guide:2.advanced.md', file: { path: '/en/2.guide/2.advanced.md' }, path: '/guide/advanced', canonicalKey: 'guide/advanced', title: 'Advanced', locale: 'en' }),
      navDoc({ id: 'content:en:3.hidden:index.md', file: { path: '/en/3.hidden/index.md' }, path: '/hidden', title: 'Hidden' }),
      doc({ id: 'content:en:3.hidden:1.secret.md', file: { path: '/en/3.hidden/1.secret.md' }, path: '/hidden/secret', title: 'Secret' }),
      navDoc({ id: 'content:de:2.leitfaden:index.md', file: { path: '/de/2.leitfaden/index.md' }, path: '/leitfaden', locale: 'de', canonicalKey: 'guide', title: 'Leitfaden' })
    ] as any, {
      '/guide': { title: 'Guides', icon: 'i-guide', badge: 'Hot' } as any,
      '/hidden': { navigation: false } as any
    }, ['icon', 'badge'])

    expect(nav).toHaveLength(2)
    expect(nav).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Guides',
        path: '/guide',
        canonicalKey: 'guide',
        locale: 'en',
        icon: 'i-guide',
        badge: 'Hot',
        children: [
          expect.objectContaining({ title: 'Intro', path: '/guide/intro', canonicalKey: 'guide/intro', locale: 'en' }),
          expect.objectContaining({ title: 'Advanced', path: '/guide/advanced', canonicalKey: 'guide/advanced', locale: 'en' })
        ]
      }),
      expect.objectContaining({
        title: 'Leitfaden',
        path: '/leitfaden',
        canonicalKey: 'guide',
        locale: 'de'
      })
    ]))
  })

  test('resolveContentNavigation merges locale fallbacks, localizes variants, and avoids duplicates', async () => {
    const docsByLocale: Record<string, any[]> = {
      de: [
        navDoc({ id: 'content:de:guide:index.md', file: { path: '/de/guide/index.md' }, path: '/leitfaden', locale: 'de', canonicalKey: 'guide', title: 'Leitfaden' }),
        doc({ id: 'content:de:guide:intro.md', file: { path: '/de/guide/intro.md' }, path: '/leitfaden/einstieg', locale: 'de', canonicalKey: 'guide/intro', title: 'Einstieg' })
      ],
      en: [
        navDoc({ id: 'content:en:guide:index.md', file: { path: '/en/guide/index.md' }, path: '/guide', locale: 'en', canonicalKey: 'guide', title: 'Guide' }),
        doc({ id: 'content:en:guide:intro.md', file: { path: '/en/guide/intro.md' }, path: '/guide/intro', locale: 'en', canonicalKey: 'guide/intro', title: 'Intro' }),
        doc({ id: 'content:en:guide:advanced.md', file: { path: '/en/guide/advanced.md' }, path: '/guide/advanced', locale: 'en', canonicalKey: 'guide/advanced', title: 'Advanced' })
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
          const locale = wheres.find(where => typeof where.locale !== 'undefined')?.locale
          const navigationQuery = wheres.some(where => where._navigation)
          return navigationQuery ? (dirConfigsByLocale[locale || 'en'] || []) : (docsByLocale[locale || 'en'] || [])
        },
        find() {
          return this.all()
        }
      }
    })
    resolveLocaleChain.mockReturnValue(['de', 'en'])

    const { resolveContentNavigation: rawResolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    // resolveContentNavigation now takes the wire pair (CS-5); build it here.
    const resolveContentNavigation = (event: any, params: any = {}) => {
      const { query, options } = toContentProviderNavigationQuery(params)
      return rawResolveContentNavigation(event, query, options)
    }
    const nav = await resolveContentNavigation(createEvent(), {
      resolveLocale: { locale: 'de', fallback: true }
    })

    expect(resolveLocaleChain).toHaveBeenCalledWith('de', 'en', { de: ['fr', 'en'] })

    expect(nav).toEqual([
      expect.objectContaining({
        title: 'Leitfaden',
        unprefixedPath: '/leitfaden',
        id: 'content:de:guide:index.md',
        canonicalKey: 'guide',
        locale: 'de',
        fallback: false,
        children: [
          expect.objectContaining({
            title: 'Einstieg',
            unprefixedPath: '/leitfaden/einstieg',
            locale: 'de',
            fallback: false
          }),
          expect.objectContaining({
            title: 'Advanced',
            path: '/de/guide/advanced',
            locale: 'en',
            fallback: true
          })
        ]
      })
    ])
    expect(nav[0]!.children).toHaveLength(2)
  })

  test('provider navigation wire keeps same-field bounds inside $not clauses', async () => {
    createServerContentQuery.mockImplementation((_event, _query = {}) => ({
      where() {
        return this
      },
      all: async () => [],
      find() {
        return this.all()
      }
    }))
    resolveLocaleChain.mockReturnValue(['en'])

    const { resolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    const wire = toContentProviderNavigationQuery({
      collection: 'docs',
      where: [{ $not: { views: { $gt: 5, $lt: 10 } } }]
    } as any)

    await resolveContentNavigation(createEvent(), wire.query, wire.options)

    expect(createServerContentQuery.mock.calls[0]?.[1]).toMatchObject({
      collection: 'docs',
      where: [
        {
          $not: {
            $and: [
              { views: { $gt: 5 } },
              { views: { $lt: 10 } }
            ]
          }
        }
      ]
    })
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
        doc({ id: 'content:de:docs:getting-started:index.md', file: { path: '/de/1.dokumentation/1.erste-schritte/index.md' }, path: '/dokumentation/erste-schritte', locale: 'de', canonicalKey: 'docs/getting-started', title: 'Einfuehrung' }),
        doc({ id: 'content:de:docs:getting-started:installation.md', file: { path: '/de/1.dokumentation/1.erste-schritte/installation.md' }, path: '/dokumentation/erste-schritte/installation', locale: 'de', canonicalKey: 'docs/getting-started/installation', title: 'Installation' }),
        doc({ id: 'content:de:docs:essentials:markdown.md', file: { path: '/de/1.dokumentation/2.grundlagen/markdown-syntax.md' }, path: '/dokumentation/grundlagen/markdown-syntax', locale: 'de', canonicalKey: 'docs/essentials/markdown-syntax', title: 'Markdown Syntax' })
      ],
      en: [
        doc({ id: 'content:en:docs:getting-started:index.md', file: { path: '/en/1.docs/1.getting-started/index.md' }, path: '/docs/getting-started', locale: 'en', canonicalKey: 'docs/getting-started', title: 'Introduction' }),
        doc({ id: 'content:en:docs:getting-started:usage.md', file: { path: '/en/1.docs/1.getting-started/usage.md' }, path: '/docs/getting-started/usage', locale: 'en', canonicalKey: 'docs/getting-started/usage', title: 'Usage' }),
        doc({ id: 'content:en:docs:essentials:fallback-lab.md', file: { path: '/en/1.docs/2.essentials/fallback-lab.md' }, path: '/docs/essentials/fallback-lab', locale: 'en', canonicalKey: 'docs/essentials/fallback-lab', title: 'Fallback Lab' })
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
          const locale = wheres.find(where => typeof where.locale !== 'undefined')?.locale
          const navigationQuery = wheres.some(where => where._navigation)
          return navigationQuery ? [] : (docsByLocale[locale || 'en'] || [])
        },
        find() {
          return this.all()
        }
      }
    })
    resolveLocaleChain.mockReturnValue(['de', 'en'])

    const { resolveContentNavigation: rawResolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    // resolveContentNavigation now takes the wire pair (CS-5); build it here.
    const resolveContentNavigation = (event: any, params: any = {}) => {
      const { query, options } = toContentProviderNavigationQuery(params)
      return rawResolveContentNavigation(event, query, options)
    }
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
      expect.objectContaining({ title: 'Installation', locale: 'de', fallback: false }),
      expect.objectContaining({ title: 'Usage', locale: 'en', fallback: true })
    ]))
    expect(nav[1]!.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Markdown Syntax', locale: 'de', fallback: false }),
      expect.objectContaining({ title: 'Fallback Lab', locale: 'en', fallback: true })
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
          const locale = wheres.find(where => typeof where.locale !== 'undefined')?.locale
          return locale === 'de'
            ? [navDoc({ id: 'content:de:guide:index.md', file: { path: '/de/guide/index.md' }, path: '/leitfaden', locale: 'de', canonicalKey: 'guide', title: 'Leitfaden' })]
            : [navDoc({ id: 'content:en:guide:index.md', file: { path: '/en/guide/index.md' }, path: '/guide', locale: 'en', canonicalKey: 'guide', title: 'Guide' })]
        },
        find() {
          return this.all()
        }
      }
    })

    const { resolveContentNavigation: rawResolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    // resolveContentNavigation now takes the wire pair (CS-5); build it here.
    const resolveContentNavigation = (event: any, params: any = {}) => {
      const { query, options } = toContentProviderNavigationQuery(params)
      return rawResolveContentNavigation(event, query, options)
    }
    const nav = await resolveContentNavigation(createEvent(), {
      where: [{ $and: [{ locale: 'de' }, { featured: true }] }]
    } as any)

    expect(resolveLocaleChain).not.toHaveBeenCalled()
    expect(nav).toEqual([
      expect.objectContaining({
        title: 'Guide',
        locale: 'en'
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

    const { resolveContentNavigation: rawResolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    // resolveContentNavigation now takes the wire pair (CS-5); build it here.
    const resolveContentNavigation = (event: any, params: any = {}) => {
      const { query, options } = toContentProviderNavigationQuery(params)
      return rawResolveContentNavigation(event, query, options)
    }
    await resolveContentNavigation(createEvent(), {
      resolveLocale: { locale: 'de', exact: true }
    })

    expect(allWheres).toHaveLength(2)
    expect(allWheres[0]).toEqual(expect.arrayContaining([{ locale: 'de' }]))
    expect(allWheres[1]).toEqual(expect.arrayContaining([{ locale: 'de' }]))
  })

  test('resolveContentNavigation always derives fresh — no persisted _nav.json cache is consulted', async () => {
    // VNEXT.md 15.4, 15.7, 25.4: the single-entry `_nav.json` cache is
    // deleted. A stale entry sitting in cache storage must never leak into a
    // navigation response — `resolveContentNavigation` has to query fresh
    // every time regardless of what (if anything) cache storage holds.
    cache._state.set('_nav.json', [{ title: 'Cached', path: '/cached' }] as any)
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

    const { resolveContentNavigation: rawResolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    // resolveContentNavigation now takes the wire pair (CS-5); build it here.
    const resolveContentNavigation = (event: any, params: any = {}) => {
      const { query, options } = toContentProviderNavigationQuery(params)
      return rawResolveContentNavigation(event, query, options)
    }

    await expect(resolveContentNavigation(createEvent())).resolves.toEqual([])
    expect(createServerContentQuery).toHaveBeenCalled()

    createServerContentQuery.mockClear()
    await resolveContentNavigation(createEvent(), { where: [{ locale: 'de' }] })
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
            navDoc({ id: 'content:docs:index.md', file: { path: '/docs/index.md' }, path: '/docs', title: 'Docs' }),
            doc({ id: 'content:docs:getting-started:index.md', file: { path: '/docs/getting-started/index.md' }, path: '/docs/getting-started', title: 'Getting Started' })
          ]
        },
        find() {
          return this.all()
        }
      }
    })

    const { resolveContentNavigation: rawResolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    // resolveContentNavigation now takes the wire pair (CS-5); build it here.
    const resolveContentNavigation = (event: any, params: any = {}) => {
      const { query, options } = toContentProviderNavigationQuery(params)
      return rawResolveContentNavigation(event, query, options)
    }
    const nav = await resolveContentNavigation(createEvent(), { collection: 'docs' })

    expect(nav).toEqual([
      expect.objectContaining({
        title: 'Getting Started',
        path: '/docs/getting-started'
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
      { title: 'Guide', path: '/guide' }
    ])
    vi.doMock('../../packages/content/src/runtime/server/navigation-query', () => ({
      resolveContentNavigation
    }))

    const { queryCollectionNavigation } = await import('../../packages/content/src/runtime/server/collection-helpers')
    const nav = await queryCollectionNavigation(event, 'docs')

    expect(nav).toEqual([
      expect.objectContaining({
        title: 'Guide',
        path: '/guide'
      })
    ])
    expect(resolveContentNavigation).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ v: 2, collection: 'docs', plan: expect.objectContaining({ collection: 'docs' }) }),
      expect.any(Object)
    )
  })

  test('server queryCollectionItemSurroundings forwards locale and canonical options to navigation loading', async () => {
    vi.resetModules()
    const resolveCollectionNavigationData = vi.fn(async (collection, _runtime, options) => options)
    const resolveCollectionItemSurroundingsData = vi.fn(async (collection, path, _runtime, options) => {
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
