import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEvent, doc, navDoc } from './_utils'
import { toContentProviderNavigationQuery } from '../../packages/content/src/public/provider-query'
import { buildContentGraph } from '../../packages/content/src/core/content/graph'

const runtimeConfig = {
  public: { content: { navigation: { fields: ['icon', 'badge'] } } },
  content: { defaultLocale: 'en', localeFallback: { de: ['fr'] } }
}

const getContent = vi.fn()
const getContentGraph = vi.fn()
const resolveLocaleChain = vi.fn()
const isPreview = vi.fn()
const resolveRuntimeEnvironment = vi.fn()

describe('navigation contracts', () => {
  beforeEach(() => {
    vi.resetModules()
    getContent.mockReset()
    getContentGraph.mockReset()
    getContentGraph.mockResolvedValue(buildContentGraph([], { locales: [], defaultLocale: '' }))
    resolveLocaleChain.mockReset()
    isPreview.mockReset()
    isPreview.mockReturnValue(false)
    resolveRuntimeEnvironment.mockReset()
    resolveRuntimeEnvironment.mockReturnValue('development')
    delete (runtimeConfig.content as any).collections

    vi.doMock('../../packages/content/src/runtime/server/runtime-config', () => ({
      getContentRuntimeConfig: () => runtimeConfig
    }))
    vi.doMock('../../packages/content/src/storage/contents', () => ({
      getContent
    }))
    vi.doMock('../../packages/content/src/integrations/nitro/ingest', () => ({
      parseContentVariants: vi.fn(),
      parseContent: vi.fn()
    }))
    vi.doMock('../../packages/content/src/integrations/nitro/storage', () => ({
      contentConfig: () => ({
        locales: [],
        defaultLocale: '',
        localeFallback: {},
        translatedSlugs: false
      })
    }))
    vi.doMock('../../packages/content/src/storage/graph', async () => {
      const actual = await vi.importActual<any>('../../packages/content/src/storage/graph')
      return { ...actual, getContentGraph }
    })
    vi.doMock('../../packages/content/src/core/content/locale', async () => {
      const actual = await vi.importActual<any>('../../packages/content/src/core/content/locale')
      return { ...actual, resolveLocaleChain }
    })
    vi.doMock('../../packages/content/src/integrations/nitro/preview', () => ({
      isPreview
    }))
    vi.doMock('../../packages/content/src/core/visibility', async () => {
      const actual = await vi.importActual<any>('../../packages/content/src/core/visibility')
      return { ...actual, resolveRuntimeEnvironment }
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  const useGraph = (documents: any[]) => {
    const normalized = documents.map(document => ({
      partial: document.navigationFile ? true : false,
      ...(!document.navigationFile ? { collection: document.collection || 'docs' } : {}),
      ...document
    }))
    const graph = buildContentGraph(normalized, {
      locales: ['en', 'de', 'fr'],
      defaultLocale: 'en'
    })
    getContentGraph.mockResolvedValue(graph)
    return graph
  }

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

  test('buildNavigation builds deterministic trees from index pages and folder metadata', async () => {
    const { buildNavigation } = await import('../../packages/content/src/features/navigation/build')

    const nav = buildNavigation([
      navDoc({ file: { path: '/en/2.guide/index.md' }, path: '/guide', title: 'Guide', sidebar: 'group' } as any),
      doc({ id: 'content:en:2.guide:1.intro.md', file: { path: '/en/2.guide/1.intro.md' }, path: '/guide/intro', canonicalKey: 'guide/intro', title: 'Intro', locale: 'en' }),
      doc({ id: 'content:en:2.guide:2.advanced.md', file: { path: '/en/2.guide/2.advanced.md' }, path: '/guide/advanced', canonicalKey: 'guide/advanced', title: 'Advanced', locale: 'en' }),
      navDoc({ id: 'content:en:3.hidden:index.md', file: { path: '/en/3.hidden/index.md' }, path: '/hidden', title: 'Hidden' }),
      doc({ id: 'content:en:3.hidden:1.secret.md', file: { path: '/en/3.hidden/1.secret.md' }, path: '/hidden/secret', title: 'Secret' }),
      navDoc({ id: 'content:de:2.leitfaden:index.md', file: { path: '/de/2.leitfaden/index.md' }, path: '/leitfaden', locale: 'de', canonicalKey: 'guide', title: 'Leitfaden' })
    ] as any, {
      '/guide': { title: 'Guides', icon: 'i-guide', badge: 'Hot' } as any,
      '/hidden': { navigation: false } as any
    }, ['icon', 'badge', 'sidebar'])

    expect(nav).toHaveLength(2)
    expect(nav).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Guides',
        path: '/guide',
        canonicalKey: 'guide',
        locale: 'en',
        icon: 'i-guide',
        badge: 'Hot',
        sidebar: 'group',
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

  test('navigation building fails clearly when a page lacks its canonical path', async () => {
    const { buildNavigation } = await import('../../packages/content/src/features/navigation/build')

    expect(() => buildNavigation([
      doc({ id: 'content:en:docs:broken.md', path: undefined, title: 'Broken' })
    ], {})).toThrow('Navigation page "content:en:docs:broken.md" is missing its canonical path.')
  })

  test('resolveContentNavigation merges canonical locale trees without projecting provider paths', async () => {
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
    useGraph(Object.values(docsByLocale).flat())
    resolveLocaleChain.mockReturnValue(['de', 'en'])

    const { resolveContentNavigation: rawResolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    // Adapt builder parameters to the wire pair expected by this lower-level helper.
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
        path: '/leitfaden',
        id: 'content:de:guide:index.md',
        canonicalKey: 'guide',
        locale: 'de',
        children: [
          expect.objectContaining({
            title: 'Einstieg',
            path: '/leitfaden/einstieg',
            locale: 'de'
          }),
          expect.objectContaining({
            title: 'Advanced',
            path: '/guide/advanced',
            locale: 'en',
            fallback: true
          })
        ]
      })
    ])
    expect(nav[0]!.children).toHaveLength(2)
  })

  test('provider navigation executes same-field bounds inside $not clauses without public query recursion', async () => {
    useGraph([
      doc({ id: 'content:en:docs:low.md', path: '/docs/low', title: 'Low', views: 3 } as any),
      doc({ id: 'content:en:docs:middle.md', path: '/docs/middle', title: 'Middle', views: 7 } as any),
      doc({ id: 'content:en:docs:high.md', path: '/docs/high', title: 'High', views: 12 } as any)
    ])
    resolveLocaleChain.mockReturnValue(['en'])

    const { resolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    const wire = toContentProviderNavigationQuery({
      collection: 'docs',
      where: [{ $not: { views: { $gt: 5, $lt: 10 } } }]
    } as any)

    const navigation = await resolveContentNavigation(createEvent(), wire.query, wire.options)

    expect(navigation).toEqual([
      expect.objectContaining({
        title: 'Docs',
        page: false,
        children: [
          expect.objectContaining({ title: 'High', path: '/docs/high' }),
          expect.objectContaining({ title: 'Low', path: '/docs/low' })
        ]
      })
    ])
    expect(getContentGraph).toHaveBeenCalledTimes(1)
  })

  test('provider navigation builds from canonical internal paths rather than public route envelopes', async () => {
    useGraph([doc({
      id: 'content:en:docs:install.md',
      title: 'Install',
      locale: 'en',
      canonicalKey: 'docs/install',
      path: '/docs/install',
      file: { path: 'docs/install.md' },
      route: { resolvedPath: '/wrong-public-path', alternates: [] }
    } as any)])
    resolveLocaleChain.mockReturnValue(['en'])

    const { resolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    const wire = toContentProviderNavigationQuery({
      collection: 'docs',
      resolveLocale: { locale: 'en', exact: true }
    })

    await expect(resolveContentNavigation(createEvent(), wire.query, wire.options)).resolves.toEqual([
      expect.objectContaining({
        title: 'Docs',
        page: false,
        children: [
          expect.objectContaining({ path: '/docs/install', title: 'Install' })
        ]
      })
    ])
  })

  test('filesystem navigation joins collectionless structural metadata and returns raw route facts', async () => {
    ;(runtimeConfig.content as any).collections = {
      docs: {
        route: '/docs',
        localePolicy: {
          localized: false,
          locales: [],
          fallback: {},
          translatedSlugs: false,
          routeMounts: { default: '/docs' }
        }
      },
      blog: {
        route: '/blog',
        localePolicy: {
          localized: false,
          locales: [],
          fallback: {},
          translatedSlugs: false,
          routeMounts: { default: '/blog' }
        }
      }
    }
    const documents = [
      doc({
        id: 'content:en:docs:guide:intro.md',
        collection: 'docs',
        canonicalKey: 'guide/intro',
        path: '/docs/guide/intro',
        file: { path: '/docs/guide/intro.md' },
        title: 'Intro'
      }),
      doc({
        id: 'content:en:docs:hidden:secret.md',
        collection: 'docs',
        canonicalKey: 'hidden/secret',
        path: '/docs/hidden/secret',
        file: { path: '/docs/hidden/secret.md' },
        title: 'Secret'
      }),
      doc({
        id: 'content:en:blog:guide:post.md',
        collection: 'blog',
        canonicalKey: 'guide/post',
        path: '/blog/guide/post',
        file: { path: '/blog/guide/post.md' },
        title: 'Blog post'
      }),
      doc({
        id: 'content:en:docs:guide:.navigation.yml',
        canonicalKey: 'guide/.navigation',
        navigationFile: true,
        partial: true,
        type: 'yaml',
        path: '/docs/guide',
        file: { path: '/docs/guide/.navigation.yml' },
        body: { title: 'Guides', icon: 'book', badge: 'New', sidebar: 'section' }
      } as any),
      doc({
        id: 'content:en:docs:hidden:.navigation.yml',
        canonicalKey: 'hidden/.navigation',
        navigationFile: true,
        partial: true,
        type: 'yaml',
        path: '/docs/hidden',
        file: { path: '/docs/hidden/.navigation.yml' },
        body: { navigation: false }
      } as any)
    ]
    const before = structuredClone(documents)
    useGraph(documents)

    const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')
    const querySpy = vi.spyOn(filesystemProvider, 'query')
    const wire = toContentProviderNavigationQuery({
      collection: 'docs',
      only: ['icon', 'badge', 'sidebar']
    })
    const raw = await filesystemProvider.navigation!(createEvent(), wire.query, wire.options)

    expect(querySpy).not.toHaveBeenCalled()
    expect(raw).toEqual([
      expect.objectContaining({
        title: 'Guides',
        icon: 'book',
        badge: 'New',
        sidebar: 'section',
        children: [
          expect.objectContaining({
            title: 'Intro',
            route: expect.objectContaining({
              collection: 'docs',
              canonicalKey: 'guide/intro',
              contentPath: '/docs/guide/intro'
            })
          })
        ]
      })
    ])
    expect(raw[0]).not.toHaveProperty('path')
    expect(raw[0]).not.toHaveProperty('route')
    expect(JSON.stringify(raw)).not.toContain('Secret')
    expect(JSON.stringify(raw)).not.toContain('Blog post')

    const { projectProviderNavigation } = await import('../../packages/content/src/runtime/server/provider-route-facts')
    const projected = projectProviderNavigation(raw, filesystemProvider.name, runtimeConfig.content)
    expect(projected[0]).not.toHaveProperty('path')
    expect((projected[0]!.children as any[])[0]).toMatchObject({ path: '/docs/guide/intro' })
    expect(documents).toEqual(before)
    querySpy.mockRestore()
  })

  test('filesystem navigation hides drafts in production and exposes them in development', async () => {
    useGraph([
      doc({ id: 'content:en:docs:public.md', collection: 'docs', canonicalKey: 'public', path: '/docs/public', title: 'Public' }),
      doc({ id: 'content:en:docs:draft.md', collection: 'docs', canonicalKey: 'draft', path: '/docs/draft', title: 'Draft', draft: true })
    ])
    const { resolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    const wire = toContentProviderNavigationQuery({ collection: 'docs' })

    resolveRuntimeEnvironment.mockReturnValue('production')
    await expect(resolveContentNavigation(createEvent(), wire.query, wire.options)).resolves.toEqual([
      expect.objectContaining({
        title: 'Docs',
        children: [
          expect.objectContaining({ title: 'Public' })
        ]
      })
    ])

    resolveRuntimeEnvironment.mockReturnValue('development')
    await expect(resolveContentNavigation(createEvent(), wire.query, wire.options)).resolves.toEqual([
      expect.objectContaining({
        title: 'Docs',
        children: [
          expect.objectContaining({ title: 'Draft' }),
          expect.objectContaining({ title: 'Public' })
        ]
      })
    ])
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

    useGraph(Object.values(docsByLocale).flat())
    resolveLocaleChain.mockReturnValue(['de', 'en'])

    const { resolveContentNavigation: rawResolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    // Adapt builder parameters to the wire pair expected by this lower-level helper.
    const resolveContentNavigation = (event: any, params: any = {}) => {
      const { query, options } = toContentProviderNavigationQuery(params)
      return rawResolveContentNavigation(event, query, options)
    }
    const nav = await resolveContentNavigation(createEvent(), {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: true }
    })

    expect(nav).toEqual([
      expect.objectContaining({
        title: 'Dokumentation',
        children: [
          expect.objectContaining({
            title: 'Einfuehrung',
            children: expect.arrayContaining([
              expect.objectContaining({ title: 'Installation', locale: 'de' }),
              expect.objectContaining({ title: 'Usage', locale: 'en', fallback: true })
            ])
          }),
          expect.objectContaining({
            title: 'Grundlagen',
            children: expect.arrayContaining([
              expect.objectContaining({ title: 'Markdown Syntax', locale: 'de' }),
              expect.objectContaining({ title: 'Fallback Lab', locale: 'en', fallback: true })
            ])
          })
        ]
      })
    ])

    delete (runtimeConfig.content as any).collections
  })

  test('resolveContentNavigation does not derive fallback locale from grouped where clauses', async () => {
    useGraph([
      navDoc({ id: 'content:de:guide:index.md', file: { path: '/de/guide/index.md' }, path: '/leitfaden', locale: 'de', canonicalKey: 'guide', title: 'Leitfaden', featured: true } as any),
      navDoc({ id: 'content:en:guide:index.md', file: { path: '/en/guide/index.md' }, path: '/guide', locale: 'en', canonicalKey: 'guide', title: 'Guide', featured: true } as any)
    ])

    const { resolveContentNavigation: rawResolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    // Adapt builder parameters to the wire pair expected by this lower-level helper.
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
        title: 'Leitfaden',
        locale: 'de'
      })
    ])
  })

  test('resolveContentNavigation applies exact locale filters to pages and directory configs', async () => {
    useGraph([
      navDoc({ id: 'content:de:guide:index.md', path: '/leitfaden', locale: 'de', title: 'Leitfaden' }),
      navDoc({ id: 'content:en:guide:index.md', path: '/guide', locale: 'en', title: 'Guide' }),
      doc({ id: 'content:de:guide:.navigation.yml', type: 'yaml', navigationFile: true, partial: true, path: '/leitfaden', locale: 'de', body: { title: 'Deutsche Anleitung' } } as any),
      doc({ id: 'content:en:guide:.navigation.yml', type: 'yaml', navigationFile: true, partial: true, path: '/guide', locale: 'en', body: { title: 'English Guide' } } as any)
    ])
    resolveLocaleChain.mockReturnValue(['de'])

    const { resolveContentNavigation: rawResolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    // Adapt builder parameters to the wire pair expected by this lower-level helper.
    const resolveContentNavigation = (event: any, params: any = {}) => {
      const { query, options } = toContentProviderNavigationQuery(params)
      return rawResolveContentNavigation(event, query, options)
    }
    const navigation = await resolveContentNavigation(createEvent(), {
      resolveLocale: { locale: 'de', exact: true }
    })

    expect(navigation).toEqual([expect.objectContaining({ title: 'Deutsche Anleitung', locale: 'de' })])
    expect(navigation).not.toEqual(expect.arrayContaining([expect.objectContaining({ locale: 'en' })]))
  })

  test('resolveContentNavigation preserves a canonical collection root until the provider boundary', async () => {
    useGraph([
      navDoc({ id: 'content:docs:index.md', collection: 'docs', file: { path: '/docs/index.md' }, path: '/docs', title: 'Docs' }),
      doc({ id: 'content:docs:getting-started:index.md', collection: 'docs', file: { path: '/docs/getting-started/index.md' }, path: '/docs/getting-started', title: 'Getting Started' })
    ])

    const { resolveContentNavigation: rawResolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    // Adapt builder parameters to the wire pair expected by this lower-level helper.
    const resolveContentNavigation = (event: any, params: any = {}) => {
      const { query, options } = toContentProviderNavigationQuery(params)
      return rawResolveContentNavigation(event, query, options)
    }
    const nav = await resolveContentNavigation(createEvent(), { collection: 'docs' })

    expect(nav).toEqual([
      expect.objectContaining({
        title: 'Docs',
        path: '/docs',
        children: [
          expect.objectContaining({
            title: 'Getting Started',
            path: '/docs/getting-started'
          })
        ]
      })
    ])
  })

})
