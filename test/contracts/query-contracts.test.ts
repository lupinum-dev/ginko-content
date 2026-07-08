import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEvent, doc } from './_utils'

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({
    public: { content: { navigation: { fields: [] } } },
    content: {
      defaultLocale: 'en',
      localeFallback: { de: ['en'] },
      collections: {
        docs: { i18n: true },
        blog: { i18n: false }
      }
    }
  })
}))

const getContentManifest = vi.fn()
const resolveLocaleChain = vi.fn()
const resolveRouteVariant = vi.fn()
const getContentsList = vi.fn()
const getContent = vi.fn()
const createServerContentQuery = vi.fn()

vi.mock('../../packages/content/src/runtime/server/manifest', () => ({
  getContentManifest,
  resolveLocaleChain,
  resolveRouteVariant
}))

vi.mock('../../packages/content/src/runtime/server/storage', () => ({
  createServerContentQuery
}))

vi.mock('../../packages/content/src/storage/contents', () => ({
  getContentsList,
  getContent
}))

vi.mock('../../packages/content/src/storage/driver', () => ({
  contentConfig: () => ({
    locales: ['en', 'de'],
    defaultLocale: 'en',
    localeFallback: { de: ['en'] }
  })
}))

describe('query execution contracts', () => {
  beforeEach(() => {
    getContentManifest.mockReset()
    resolveLocaleChain.mockReset()
    resolveRouteVariant.mockReset()
    getContentsList.mockReset()
    getContent.mockReset()
    createServerContentQuery.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('executeContentQuery resolves locale variants and composes count/skip/limit/projection', async () => {
    const dataset = [
      doc({ collection: 'docs', title: 'Intro EN', canonicalKey: 'docs/intro', locale: 'en', path: '/guide/intro', order: 2 }),
      doc({ collection: 'docs', title: 'Intro DE', id: 'content:de:guide:intro.md', file: { path: '/de/guide/intro.md' }, canonicalKey: 'docs/intro', locale: 'de', path: '/leitfaden/einstieg', order: 1 }),
      doc({ collection: 'docs', title: 'Advanced EN', id: 'content:en:guide:advanced.md', file: { path: '/en/guide/advanced.md' }, canonicalKey: 'docs/advanced', locale: 'en', path: '/guide/advanced', order: 4 }),
      doc({ collection: 'docs', title: 'Guide EN', id: 'content:en:guide:index.md', file: { path: '/en/guide/index.md' }, canonicalKey: 'docs/guide', locale: 'en', path: '/guide', order: 3 }),
      doc({ collection: 'docs', title: 'Middle DE', id: 'content:de:guide:middle.md', file: { path: '/de/guide/middle.md' }, canonicalKey: 'docs/middle', locale: 'de', path: '/leitfaden/mitte', order: 3.5 }),
      doc({ collection: 'docs', title: 'Zed EN', id: 'content:en:guide:zed.md', file: { path: '/en/guide/zed.md' }, canonicalKey: 'docs/zed', locale: 'en', path: '/guide/zed', order: 0 }),
      doc({ collection: 'docs', title: 'Zed DE', id: 'content:de:guide:zed.md', file: { path: '/de/guide/zed.md' }, canonicalKey: 'docs/zed', locale: 'de', path: '/leitfaden/zed', order: 5 })
    ]

    getContentsList.mockResolvedValue(dataset)
    getContentManifest.mockResolvedValue({
      byCanonical: {
        'docs/intro': { en: { locale: 'en' }, de: { locale: 'de' } },
        'docs/advanced': { en: { locale: 'en' } },
        'docs/guide': { en: { locale: 'en' } },
        'docs/middle': { de: { locale: 'de' } },
        'docs/zed': { en: { locale: 'en' }, de: { locale: 'de' } }
      }
    })
    resolveLocaleChain.mockReturnValue(['de', 'en'])

    const { executeContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    const event = createEvent()

    const list = await executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      sort: [{ order: 1 }],
      only: ['title', 'resolved'],
      without: ['body']
    } as any)

    expect(list).toEqual({
      result: [
      {
        title: 'Intro DE',
        resolved: {
          requestedLocale: 'de',
          locale: 'de',
          fallback: false,
          availableLocales: ['en', 'de']
        }
      },
      {
        title: 'Guide EN',
        resolved: {
          requestedLocale: 'de',
          locale: 'en',
          fallback: true,
          availableLocales: ['en']
        }
      },
      {
        title: 'Middle DE',
        resolved: {
          requestedLocale: 'de',
          locale: 'de',
          fallback: false,
          availableLocales: ['de']
        }
      },
      {
        title: 'Advanced EN',
        resolved: {
          requestedLocale: 'de',
          locale: 'en',
          fallback: true,
          availableLocales: ['en']
        }
      },
      {
        title: 'Zed DE',
        resolved: {
          requestedLocale: 'de',
          locale: 'de',
          fallback: false,
          availableLocales: ['en', 'de']
        }
      }
      ],
      skip: 0,
      limit: 0,
      total: 5
    })

    await expect(executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', exact: true },
      first: true,
      sort: [{ order: 1 }]
    } as any)).resolves.toMatchObject({
      result: {
        title: 'Intro DE',
        resolved: { locale: 'de' }
      }
    })

    await expect(executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      count: true
    } as any)).resolves.toEqual({ result: 5 })

    await expect(executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      sort: [{ order: 1 }],
      skip: 1,
      limit: 1
    } as any)).resolves.toMatchObject({
      result: [
        expect.objectContaining({ title: 'Guide EN' })
      ],
      skip: 1,
      limit: 1,
      total: 5
    })
  })

  test('executeContentQuery reports not-found errors for missing locale-resolved results', async () => {
    const dataset = [
      doc({ collection: 'docs', title: 'Intro DE', id: 'content:de:guide:intro.md', file: { path: '/de/guide/intro.md' }, canonicalKey: 'docs/intro', locale: 'de', path: '/leitfaden/einstieg', order: 1 }),
      doc({ collection: 'docs', title: 'Guide EN', id: 'content:en:guide:index.md', file: { path: '/en/guide/index.md' }, canonicalKey: 'docs/guide', locale: 'en', path: '/guide', order: 2 }),
      doc({ collection: 'docs', title: 'Advanced EN', id: 'content:en:guide:advanced.md', file: { path: '/en/guide/advanced.md' }, canonicalKey: 'docs/advanced', locale: 'en', path: '/guide/advanced', order: 3 })
    ]

    getContentsList.mockResolvedValue(dataset)
    getContentManifest.mockResolvedValue({
      byCanonical: {
        'docs/intro': { de: { locale: 'de' } },
        'docs/guide': { en: { locale: 'en' } },
        'docs/advanced': { en: { locale: 'en' } }
      }
    })
    resolveLocaleChain.mockReturnValue(['de', 'en'])

    const { executeContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    const event = createEvent()

    await expect(executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      first: true,
      where: [{ path: '/missing' }]
    } as any)).rejects.toMatchObject({
      statusCode: 404
    })
  })

  test('executeContentQuery resolves route variants and returns variant paths', async () => {
    getContentsList.mockResolvedValue([
      doc({
        collection: 'docs',
        id: 'content:en:guide:intro.md',
        canonicalKey: 'docs/intro',
        path: '/guide/intro',
        title: 'Intro EN'
      }),
      doc({
        collection: 'docs',
        id: 'content:en:_dir.yml',
        path: '/guide/intro',
        navigationFile: true,
        partial: true,
        body: { badge: 'New' }
      })
    ])

    const { executeContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')

    await expect(executeContentQuery(createEvent(), {
      collection: 'docs',
      first: true,
      resolveVariant: {
        path: '/guide/intro',
        locale: 'de',
        fallback: ['en']
      }
    } as any)).resolves.toMatchObject({
      result: {
        title: 'Intro EN',
        resolved: {
          requestedLocale: 'de',
          locale: 'en',
          fallback: true,
          variantPaths: {
            en: '/guide/intro'
          }
        },
        _dir: {
          badge: 'New'
        }
      }
    })
  })

  test('canonical query plan applies collection prefilter and projection in the correct order', async () => {
    const { executeQueryPlanOnDocuments } = await import('../../packages/content/src/core/query/execute')
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')
    const { createQuery } = await import('../../packages/content/src/core/query/builder')
    const contents = [
      doc({ collection: 'docs', path: '/guide/intro', title: 'Intro', order: 1, group: 'docs' }),
      doc({ collection: 'docs', path: '/guide/advanced', title: 'Advanced', order: 2, group: 'docs' }),
      doc({ collection: 'blog', path: '/blog/post', title: 'Post', order: 0, group: 'blog' })
    ]

    const query = createQuery(async (builtQuery: any) => {
      const plan = lowerQueryPlan(builtQuery.params())
      return executeQueryPlanOnDocuments(contents, plan)
    }, {
      initialParams: {
        collection: 'docs'
      } as any
    })
      .where('path', '=', '/guide/advanced')
      .where('group', '=', 'docs')
      .order('order', 'ASC')
      .select('title', 'path')

    const plan = lowerQueryPlan((query as any).params())
    const result = executeQueryPlanOnDocuments(contents, plan)

    expect(result.result).toEqual([
      { title: 'Advanced', path: '/guide/advanced' }
    ])
  })

  test('executeContentQuery rejects empty public graph queries', async () => {
    const { executeContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')

    await expect(executeContentQuery(createEvent(), {
      where: [{ path: '/guide/intro' }]
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid content query'
    })
  })

  test('executeContentQuery rejects public regex filters before graph execution', async () => {
    const { executeContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')

    await expect(executeContentQuery(createEvent(), {
      collection: 'docs',
      where: [{ title: { $regex: 'intro' } }]
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid content query'
    })

    await expect(executeContentQuery(createEvent(), {
      collection: 'docs',
      where: [{ title: /intro/ }]
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid content query'
    })
  })

  test('executeContentQuery accepts public path prefix filters without exposing regex', async () => {
    const dataset = [
      doc({ collection: 'docs', id: 'content:guide:intro.md', file: { path: '/guide/intro.md' }, canonicalKey: 'guide/intro', path: '/guide/intro', title: 'Intro' }),
      doc({ collection: 'docs', id: 'content:guide:advanced.md', file: { path: '/guide/advanced.md' }, canonicalKey: 'guide/advanced', path: '/guide/advanced', title: 'Advanced' }),
      doc({ collection: 'docs', id: 'content:api:index.md', file: { path: '/api/index.md' }, canonicalKey: 'api/index', path: '/api', title: 'API' })
    ]
    getContentsList.mockResolvedValue(dataset)
    getContentManifest.mockResolvedValue({ byCanonical: {} })

    const { executeContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')

    await expect(executeContentQuery(createEvent(), {
      collection: 'docs',
      where: [{ path: { $prefix: '/guide' } }],
      sort: [{ title: 1 }],
      only: ['title', 'path']
    } as any)).resolves.toEqual({
      result: [
        { title: 'Advanced', path: '/guide/advanced' },
        { title: 'Intro', path: '/guide/intro' }
      ],
      skip: 0,
      limit: 0,
      total: 2
    })
  })

  test('executeContentQuery clamps public pagination bounds', async () => {
    const dataset = [
      doc({ collection: 'docs', id: 'content:guide:a.md', file: { path: '/guide/a.md' }, canonicalKey: 'guide/a', path: '/guide/a', title: 'A', order: 1 }),
      doc({ collection: 'docs', id: 'content:guide:b.md', file: { path: '/guide/b.md' }, canonicalKey: 'guide/b', path: '/guide/b', title: 'B', order: 2 }),
      doc({ collection: 'docs', id: 'content:guide:c.md', file: { path: '/guide/c.md' }, canonicalKey: 'guide/c', path: '/guide/c', title: 'C', order: 3 })
    ]

    getContentsList.mockResolvedValue(dataset)
    getContentManifest.mockResolvedValue({ byCanonical: {} })

    const { executeContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')

    await expect(executeContentQuery(createEvent(), {
      collection: 'docs',
      sort: [{ order: 1 }],
      skip: -5,
      limit: 9999
    } as any)).resolves.toMatchObject({
      result: [
        { title: 'A' },
        { title: 'B' },
        { title: 'C' }
      ],
      skip: 0,
      limit: 100,
      total: 3
    })
  })
})
