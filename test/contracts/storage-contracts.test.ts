import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { hash as ohash } from 'ohash'
import { createEvent, doc } from './_utils'

describe('storage contracts', () => {
  const runtimeContent = {
    sources: {},
    defaultLocale: 'en',
    locales: ['en', 'de'],
    translatedSlugs: false,
    strictTranslatedSlugs: false,
    respectPathCase: false,
    cacheVersion: 'v1',
    cacheIntegrity: 'integrity',
    ignores: [],
    collections: {}
  }

  const parsedCacheState = new Map<string, any>()
  const sourceItems = new Map<string, any>()
  const sourceMeta = new Map<string, any>()
  const validationSpy = vi.fn()
  const parseVariants = vi.fn()

  const event = createEvent()

  beforeEach(() => {
    vi.resetModules()
    parsedCacheState.clear()
    sourceItems.clear()
    sourceMeta.clear()
    validationSpy.mockReset()
    // validateContentGraph returns Result<void, ContentError>; default to ok().
    validationSpy.mockReturnValue({ ok: true, value: undefined })
    parseVariants.mockReset()

    sourceItems.set('content:guide:intro.md', '# Intro')
    sourceMeta.set('content:guide:intro.md', { mtime: 1, size: 10 })
    parseVariants.mockResolvedValue([
      doc({
        id: 'content:guide:intro.md',
        file: { path: '/guide/intro.md' },
        path: '/guide/intro',
        canonicalKey: 'guide/intro'
      }),
      doc({
        id: 'content:guide:intro.md#__locale=de',
        file: { path: '/guide/intro.md' },
        path: '/guide/einstieg',
        canonicalKey: 'guide/intro',
        locale: 'de',
        title: 'Einstieg'
      })
    ])

    vi.doMock('#imports', () => ({
      useRuntimeConfig: () => ({ content: runtimeContent })
    }))
    vi.doMock('../../packages/content/src/integrations/nitro/storage', () => ({
      contentConfig: () => runtimeContent,
      contentIgnorePredicate: (id: string) => !id.includes('ignored'),
      getContentsIds: vi.fn(async () => ['content:guide:intro.md']),
      resolveStorageId: vi.fn(async (_event, id: string) => id),
      cacheStorage: () => ({
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {})
      }),
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
      })
    }))
    vi.doMock('../../packages/content/src/integrations/nitro/ingest', () => ({
      parseContentVariants: parseVariants,
      parseContent: vi.fn()
    }))
    vi.doMock('../../packages/content/src/storage/validation', async () => {
      const actual = await vi.importActual<any>('../../packages/content/src/storage/validation')
      return {
        ...actual,
        validateContentGraph: validationSpy
      }
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('chunksFromArray splits boundaries correctly', async () => {
    const { chunksFromArray } = await import('../../packages/content/src/storage/contents')
    expect([...chunksFromArray([1, 2, 3, 4, 5], 2)]).toEqual([[1, 2], [3, 4], [5]])
  })

  test('getContentsList caches by config key and reuses event-local results', async () => {
    const { getContentsList } = await import('../../packages/content/src/storage/contents')

    const first = await getContentsList(event)
    const second = await getContentsList(event)

    expect(first).toHaveLength(2)
    expect(second).toBe(first)
    expect(parseVariants).toHaveBeenCalledTimes(1)
  })

  test('getContentsList single-flight deduplicates concurrent reads within one request', async () => {
    let release!: () => void
    parseVariants.mockImplementation(() => new Promise(resolve => {
      release = () => resolve([
        doc({
          id: 'content:guide:intro.md',
          file: { path: '/guide/intro.md' },
          path: '/guide/intro'
        })
      ])
    }))

    const { getContentsList } = await import('../../packages/content/src/storage/contents')
    const eventA = createEvent()

    const pending = Promise.all([getContentsList(eventA), getContentsList(eventA)])
    while (!release) {
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    release()
    await pending

    expect(parseVariants).toHaveBeenCalledTimes(1)
  })

  test('getContentsList does not share in-flight work across requests', async () => {
    let releases = 0
    parseVariants.mockImplementation(() => new Promise(resolve => {
      setTimeout(() => {
        releases += 1
        resolve([
          doc({
            id: `content:guide:intro-${releases}.md`,
            file: { path: '/guide/intro.md' },
            path: '/guide/intro'
          })
        ])
      }, 0)
    }))

    const { getContentsList } = await import('../../packages/content/src/storage/contents')

    await Promise.all([getContentsList(createEvent()), getContentsList(createEvent())])

    expect(parseVariants).toHaveBeenCalledTimes(2)
  })

  test('getContent selects inline locale variants and falls back to default', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { getContent } = await import('../../packages/content/src/storage/contents')

    await expect(getContent(createEvent(), 'content:guide:intro.md#__locale=de')).resolves.toMatchObject({
      locale: 'de',
      title: 'Einstieg'
    })

    await expect(getContent(createEvent(), 'content:guide:intro.md#__locale=fr')).resolves.toMatchObject({
      locale: 'en',
      title: 'Getting Started'
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Locale variant "fr" not found'))
  })

  test('cached parsed artifacts bypass reparsing until the hash changes', async () => {
    parsedCacheState.set('content:guide:intro.md', {
      hash: ohash({
        body: ohash('# Intro'),
        version: runtimeContent.cacheVersion,
        integrity: runtimeContent.cacheIntegrity,
        collections: runtimeContent.collections,
        defaultLocale: runtimeContent.defaultLocale,
        locales: runtimeContent.locales,
        translatedSlugs: runtimeContent.translatedSlugs,
        strictTranslatedSlugs: runtimeContent.strictTranslatedSlugs,
        respectPathCase: runtimeContent.respectPathCase
      }),
      parsed: [doc({ id: 'content:guide:intro.md', path: '/guide/intro', file: { path: '/guide/intro.md' } })]
    })

    const { getContent } = await import('../../packages/content/src/storage/contents')
    await getContent(createEvent(), 'content:guide:intro.md')
    expect(parseVariants).toHaveBeenCalledTimes(0)

    parsedCacheState.clear()
    sourceMeta.set('content:guide:intro.md', { mtime: 2, size: 10 })

    const otherEvent = createEvent()
    const { getContentsList } = await import('../../packages/content/src/storage/contents')
    await getContentsList(otherEvent)
    expect(parseVariants).toHaveBeenCalledTimes(1)
  })

  test('cached parsed artifacts reparse when collection config changes', async () => {
    parsedCacheState.set('content:guide:intro.md', {
      hash: ohash({
        body: ohash('# Intro'),
        version: runtimeContent.cacheVersion,
        integrity: runtimeContent.cacheIntegrity,
        collections: {},
        defaultLocale: runtimeContent.defaultLocale,
        locales: runtimeContent.locales,
        translatedSlugs: runtimeContent.translatedSlugs,
        strictTranslatedSlugs: runtimeContent.strictTranslatedSlugs,
        respectPathCase: runtimeContent.respectPathCase
      }),
      parsed: [doc({ id: 'content:guide:intro.md', path: '/guide/intro', file: { path: '/guide/intro.md' } })]
    })
    runtimeContent.collections = {
      docs: { source: 'guide/**/*.md' }
    }

    const { getContent } = await import('../../packages/content/src/storage/contents')
    await getContent(createEvent(), 'content:guide:intro.md')

    expect(parseVariants).toHaveBeenCalledTimes(1)
  })

  test('cached parsed artifacts reparse when same-size source content changes', async () => {
    sourceItems.set('content:guide:intro.md', '# One')
    sourceMeta.set('content:guide:intro.md', { mtime: 1, size: 5 })
    parseVariants.mockImplementation(async (id: string, body: string) => [
      doc({
        id: 'content:guide:intro.md',
        file: { path: '/guide/intro.md' },
        path: '/guide/intro',
        title: body
      })
    ])
    const { getContent } = await import('../../packages/content/src/storage/contents')

    await expect(getContent(createEvent(), 'content:guide:intro.md')).resolves.toMatchObject({
      title: '# One'
    })

    sourceItems.set('content:guide:intro.md', '# Two')
    sourceMeta.set('content:guide:intro.md', { mtime: 1, size: 5 })

    await expect(getContent(createEvent(), 'content:guide:intro.md')).resolves.toMatchObject({
      title: '# Two'
    })
    expect(parseVariants).toHaveBeenCalledTimes(2)
  })

  test('malformed parsed cache artifacts are ignored and replaced', async () => {
    parsedCacheState.set('content:guide:intro.md', '# raw source is not a parsed artifact')

    const { getContent } = await import('../../packages/content/src/storage/contents')
    await expect(getContent(createEvent(), 'content:guide:intro.md')).resolves.toMatchObject({
      path: '/guide/intro'
    })

    expect(parseVariants).toHaveBeenCalledTimes(1)
    expect(parsedCacheState.get('content:guide:intro.md')).toMatchObject({
      hash: expect.any(String),
      parsed: expect.any(Array)
    })
  })

  test('ignored content ids return a null-body placeholder', async () => {
    vi.resetModules()
    vi.doMock('#imports', () => ({
      useRuntimeConfig: () => ({ content: runtimeContent })
    }))
    vi.doMock('../../packages/content/src/integrations/nitro/storage', () => ({
      contentConfig: () => runtimeContent,
      contentIgnorePredicate: () => false,
      getContentsIds: vi.fn(async () => ['ignored:file.md']),
      resolveStorageId: vi.fn(async (_event, id: string) => id),
      cacheStorage: () => ({
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {})
      }),
      sourceStorage: () => ({
        getItem: vi.fn(),
        getMeta: vi.fn()
      }),
      cacheParsedStorage: () => ({
        getItem: vi.fn(async () => null),
        setItem: vi.fn()
      })
    }))
    vi.doMock('../../packages/content/src/integrations/nitro/ingest', () => ({
      parseContentVariants: parseVariants,
      parseContent: vi.fn()
    }))
    vi.doMock('../../packages/content/src/storage/validation', async () => {
      const actual = await vi.importActual<any>('../../packages/content/src/storage/validation')
      return {
        ...actual,
        validateContentGraph: validationSpy
      }
    })

    const { getContentsList } = await import('../../packages/content/src/storage/contents')
    await expect(getContentsList(createEvent())).resolves.toEqual([])
  })

  test('validation and reference resolution cover canonical ids, collection scope, and locale fallback', async () => {
    const { validateContentGraph } = await vi.importActual<any>('../../packages/content/src/storage/validation')
    const { buildReferenceTargets } = await import('../../packages/content/src/core/references/resolve')
    const documents = [
      doc({
        collection: 'docs',
        ref: 'intro'
      }),
      doc({
        id: 'content:de:guide:intro.md',
        file: { path: '/de/guide/intro.md' },
        path: '/leitfaden/einstieg',
        locale: 'de',
        collection: 'docs',
        canonicalKey: 'guide/intro',
        ref: 'intro'
      }),
      doc({
        id: 'content:en:authors:evan.yml',
        file: { path: '/authors/evan.yml' },
        path: '/authors/evan',
        collection: 'authors',
        type: 'yaml',
        canonicalKey: 'authors/evan',
        ref: 'authors/evan'
      })
    ]

    expect(buildReferenceTargets(documents, ['en', 'de']).get('guide/intro')).toBe('guide/intro')
    expect(buildReferenceTargets(documents, ['en', 'de']).get('intro')).toBe('guide/intro')
    expect(buildReferenceTargets(documents, ['en', 'de']).get('de/leitfaden/einstieg')).toBe('guide/intro')
    expect(buildReferenceTargets(documents, ['en', 'de']).get('authors/evan')).toBe('authors/evan')
    expect(buildReferenceTargets(documents, ['en', 'de']).get('missing')).toBeUndefined()

    const outcome = validateContentGraph([
      ...documents,
      doc({
        id: 'content:de:guide:intro-duplicate.md',
        file: { path: '/de/guide/intro-duplicate.md' },
        path: '/leitfaden/einstieg',
        locale: 'de',
        canonicalKey: 'guide/other'
      })
    ], {
      locales: ['en', 'de'],
      translatedSlugs: false,
      collections: {}
    })
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'DUPLICATE_LOCALIZED_PATH',
        message: expect.stringMatching(/duplicate localized path/)
      }
    })
  })
})
