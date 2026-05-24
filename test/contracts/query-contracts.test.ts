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
      doc({ _collection: 'docs', title: 'Intro EN', _canonicalKey: 'docs/intro', _locale: 'en', _path: '/guide/intro', order: 2 }),
      doc({ _collection: 'docs', title: 'Intro DE', _id: 'content:de:guide:intro.md', _file: '/de/guide/intro.md', _canonicalKey: 'docs/intro', _locale: 'de', _path: '/leitfaden/einstieg', order: 1 }),
      doc({ _collection: 'docs', title: 'Advanced EN', _id: 'content:en:guide:advanced.md', _file: '/en/guide/advanced.md', _canonicalKey: 'docs/advanced', _locale: 'en', _path: '/guide/advanced', order: 4 }),
      doc({ _collection: 'docs', title: 'Guide EN', _id: 'content:en:guide:index.md', _file: '/en/guide/index.md', _canonicalKey: 'docs/guide', _locale: 'en', _path: '/guide', order: 3 }),
      doc({ _collection: 'docs', title: 'Middle DE', _id: 'content:de:guide:middle.md', _file: '/de/guide/middle.md', _canonicalKey: 'docs/middle', _locale: 'de', _path: '/leitfaden/mitte', order: 3.5 }),
      doc({ _collection: 'docs', title: 'Zed EN', _id: 'content:en:guide:zed.md', _file: '/en/guide/zed.md', _canonicalKey: 'docs/zed', _locale: 'en', _path: '/guide/zed', order: 0 }),
      doc({ _collection: 'docs', title: 'Zed DE', _id: 'content:de:guide:zed.md', _file: '/de/guide/zed.md', _canonicalKey: 'docs/zed', _locale: 'de', _path: '/leitfaden/zed', order: 5 })
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
      only: ['title', '_resolvedLocale', '_requestedLocale', '_fallback', '_availableLocales'],
      without: ['body']
    } as any)

    expect(list).toEqual([
      {
        title: 'Intro DE',
        _requestedLocale: 'de',
        _resolvedLocale: 'de',
        _fallback: false,
        _availableLocales: ['en', 'de']
      },
      {
        title: 'Guide EN',
        _requestedLocale: 'de',
        _resolvedLocale: 'en',
        _fallback: true,
        _availableLocales: ['en']
      },
      {
        title: 'Middle DE',
        _requestedLocale: 'de',
        _resolvedLocale: 'de',
        _fallback: false,
        _availableLocales: ['de']
      },
      {
        title: 'Advanced EN',
        _requestedLocale: 'de',
        _resolvedLocale: 'en',
        _fallback: true,
        _availableLocales: ['en']
      },
      {
        title: 'Zed DE',
        _requestedLocale: 'de',
        _resolvedLocale: 'de',
        _fallback: false,
        _availableLocales: ['en', 'de']
      }
    ])

    await expect(executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', exact: true },
      first: true,
      sort: [{ order: 1 }]
    } as any)).resolves.toMatchObject({
      title: 'Intro DE',
      _resolvedLocale: 'de'
    })

    await expect(executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      count: true
    } as any)).resolves.toBe(5)

    await expect(executeContentQuery(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      sort: [{ order: 1 }],
      skip: 1,
      limit: 1
    } as any)).resolves.toMatchObject([
      expect.objectContaining({ title: 'Guide EN' })
    ])
  })

  test('executeContentQuery reports not-found errors for missing locale-resolved results', async () => {
    const dataset = [
      doc({ _collection: 'docs', title: 'Intro DE', _id: 'content:de:guide:intro.md', _file: '/de/guide/intro.md', _canonicalKey: 'docs/intro', _locale: 'de', _path: '/leitfaden/einstieg', order: 1 }),
      doc({ _collection: 'docs', title: 'Guide EN', _id: 'content:en:guide:index.md', _file: '/en/guide/index.md', _canonicalKey: 'docs/guide', _locale: 'en', _path: '/guide', order: 2 }),
      doc({ _collection: 'docs', title: 'Advanced EN', _id: 'content:en:guide:advanced.md', _file: '/en/guide/advanced.md', _canonicalKey: 'docs/advanced', _locale: 'en', _path: '/guide/advanced', order: 3 })
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
      where: [{ _path: '/missing' }]
    } as any)).rejects.toMatchObject({
      statusCode: 404
    })
  })

  test('executeContentQuery resolves route variants and returns variant paths', async () => {
    getContentsList.mockResolvedValue([
      doc({
        _collection: 'docs',
        _id: 'content:en:guide:intro.md',
        _canonicalKey: 'docs/intro',
        _path: '/guide/intro',
        title: 'Intro EN'
      }),
      doc({
        _collection: 'docs',
        _id: 'content:en:_dir.yml',
        _path: '/guide/intro',
        _navigation: true,
        _partial: true,
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
      title: 'Intro EN',
      _requestedLocale: 'de',
      _resolvedLocale: 'en',
      _fallback: true,
      _variantPaths: {
        en: '/guide/intro'
      },
      _dir: {
        badge: 'New'
      }
    })
  })

  test('canonical query plan applies collection prefilter and projection in the correct order', async () => {
    const { executeQueryPlanOnDocuments } = await import('../../packages/content/src/core/query/execute')
    const { lowerQueryPlan } = await import('../../packages/content/src/core/query/lower')
    const { createQuery } = await import('../../packages/content/src/core/query/builder')
    const contents = [
      doc({ _collection: 'docs', _path: '/guide/intro', title: 'Intro', order: 1, group: 'docs' }),
      doc({ _collection: 'docs', _path: '/guide/advanced', title: 'Advanced', order: 2, group: 'docs' }),
      doc({ _collection: 'blog', _path: '/blog/post', title: 'Post', order: 0, group: 'blog' })
    ]

    const query = createQuery(async (builtQuery: any) => {
      const plan = lowerQueryPlan(builtQuery.params())
      return executeQueryPlanOnDocuments(contents, plan)
    }, {
      initialParams: {
        collection: 'docs'
      } as any
    })
      .where('_path', '=', '/guide/advanced')
      .where('group', '=', 'docs')
      .order('order', 'ASC')
      .select('title', '_path')

    const plan = lowerQueryPlan((query as any).params())
    const result = executeQueryPlanOnDocuments(contents, plan)

    expect(result.result).toEqual([
      { title: 'Advanced', _path: '/guide/advanced' }
    ])
  })

  test('executeContentQuery rejects empty public graph queries', async () => {
    const { executeContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')

    await expect(executeContentQuery(createEvent(), {
      where: [{ _path: '/guide/intro' }]
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
      doc({ _collection: 'docs', _id: 'content:guide:intro.md', _file: '/guide/intro.md', _canonicalKey: 'guide/intro', _path: '/guide/intro', title: 'Intro' }),
      doc({ _collection: 'docs', _id: 'content:guide:advanced.md', _file: '/guide/advanced.md', _canonicalKey: 'guide/advanced', _path: '/guide/advanced', title: 'Advanced' }),
      doc({ _collection: 'docs', _id: 'content:api:index.md', _file: '/api/index.md', _canonicalKey: 'api/index', _path: '/api', title: 'API' })
    ]
    getContentsList.mockResolvedValue(dataset)
    getContentManifest.mockResolvedValue({ byCanonical: {} })

    const { executeContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')

    await expect(executeContentQuery(createEvent(), {
      collection: 'docs',
      where: [{ path: { $prefix: '/guide' } }],
      sort: [{ title: 1 }],
      only: ['title', '_path']
    } as any)).resolves.toEqual([
      { title: 'Advanced', _path: '/guide/advanced' },
      { title: 'Intro', _path: '/guide/intro' }
    ])
  })

  test('executeContentQuery clamps public pagination bounds', async () => {
    const dataset = [
      doc({ _collection: 'docs', _id: 'content:guide:a.md', _file: '/guide/a.md', _canonicalKey: 'guide/a', _path: '/guide/a', title: 'A', order: 1 }),
      doc({ _collection: 'docs', _id: 'content:guide:b.md', _file: '/guide/b.md', _canonicalKey: 'guide/b', _path: '/guide/b', title: 'B', order: 2 }),
      doc({ _collection: 'docs', _id: 'content:guide:c.md', _file: '/guide/c.md', _canonicalKey: 'guide/c', _path: '/guide/c', title: 'C', order: 3 })
    ]

    getContentsList.mockResolvedValue(dataset)
    getContentManifest.mockResolvedValue({ byCanonical: {} })

    const { executeContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')

    await expect(executeContentQuery(createEvent(), {
      collection: 'docs',
      sort: [{ order: 1 }],
      skip: -5,
      limit: 9999
    } as any)).resolves.toMatchObject([
      { title: 'A' },
      { title: 'B' },
      { title: 'C' }
    ])
  })
})
