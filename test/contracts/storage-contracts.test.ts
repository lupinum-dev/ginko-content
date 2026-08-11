import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { hash as ohash } from 'ohash'
import { z } from 'zod'
import { createEvent, doc } from './_utils'
import type { ResolvedCollectionLocalePolicy } from '../../packages/content/src/features/localization/locale-policy'
import pathMeta from '../../packages/content/src/parsers/path-meta'
import { validateCollectionDocument } from '../../packages/content/src/runtime/server/validation'
import { CACHE_VERSION } from '../../packages/content/src/utils'

describe('storage contracts', () => {
  const runtimeContent = {
    sources: {},
    defaultLocale: 'en',
    locales: ['en', 'de'],
    translatedSlugs: false,
    strictTranslatedSlugs: false,
    respectPathCase: false,
    cacheVersion: CACHE_VERSION,
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

    // The graph stores canonical, mount-agnostic paths, but authors have always
    // written references against the mounted provider path. Both spellings must
    // resolve, and both must land on the SAME canonical id.
    const { providerReferencePathAliases } = await import(
      '../../packages/content/src/features/localization/reference-path'
    )
    const mountedPolicies = {
      docs: {
        localized: true,
        locales: ['en', 'de'],
        defaultLocale: 'en',
        fallback: { de: ['en'] },
        translatedSlugs: true,
        routeMounts: { en: '/guide', de: '/leitfaden' }
      }
    } satisfies Readonly<Record<string, ResolvedCollectionLocalePolicy>>
    const canonicalDocuments = [
      doc({
        id: 'content:en:guide:deep:nested.md',
        file: { path: '/en/guide/deep/nested.md' },
        collection: 'docs',
        locale: 'en',
        // Canonical: the `/guide` mount is not part of graph identity.
        path: '/deep/nested',
        canonicalKey: 'deep/nested-page',
        ref: 'nested'
      })
    ]
    const aliasedTargets = buildReferenceTargets(
      canonicalDocuments,
      ['en', 'de'],
      document => providerReferencePathAliases(document, mountedPolicies)
    )

    // Canonical spelling, authored alias, and mounted spelling all agree.
    expect(aliasedTargets.get('deep/nested')).toBe('deep/nested-page')
    expect(aliasedTargets.get('nested')).toBe('deep/nested-page')
    expect(aliasedTargets.get('guide/deep/nested')).toBe('deep/nested-page')
    // Without the alias the mounted spelling is unknown, which is exactly the
    // regression this alias exists to prevent.
    expect(buildReferenceTargets(canonicalDocuments, ['en', 'de']).get('guide/deep/nested')).toBeUndefined()

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

describe('collection schema validation', () => {
  test('validates core-owned sidebar metadata on navigation files and pages', () => {
    const validNavigationFile = validateCollectionDocument(doc({
      id: 'content:en:docs:.navigation.yml',
      file: { path: '/en/docs/.navigation.yml' },
      type: 'yaml',
      navigationFile: true,
      partial: true,
      sidebar: 'section'
    } as any))
    const invalidNavigationFile = validateCollectionDocument(doc({
      id: 'content:en:docs:.navigation.yml',
      file: { path: '/en/docs/.navigation.yml' },
      type: 'yaml',
      navigationFile: true,
      partial: true,
      sidebar: 'sction'
    } as any))
    const invalidPage = validateCollectionDocument(doc({
      id: 'content:en:docs:intro.md',
      file: { path: '/en/docs/intro.md' },
      type: 'markdown',
      sidebar: 'sction'
    } as any))
    const validPage = validateCollectionDocument(doc({
      id: 'content:en:docs:intro.md',
      file: { path: '/en/docs/intro.md' },
      type: 'markdown',
      sidebar: 'group'
    } as any))
    const invalidNestedPage = validateCollectionDocument(doc({
      id: 'content:en:docs:nested.md',
      file: { path: '/en/docs/nested.md' },
      type: 'markdown',
      navigation: { sidebar: 'sction' }
    } as any))
    const structuredData = validateCollectionDocument(doc({
      id: 'content:data:layout.yml',
      type: 'yaml',
      sidebar: 'application-specific-value'
    } as any))

    expect(validNavigationFile.ok).toBe(true)
    expect(validPage.ok).toBe(true)
    expect(structuredData.ok).toBe(true)
    expect(invalidNavigationFile).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_NAVIGATION_YAML',
        message: expect.stringContaining('sidebar must be "section" or "group"')
      }
    })
    expect(invalidPage).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_NAVIGATION_METADATA',
        message: expect.stringContaining('sidebar must be "section" or "group"')
      }
    })
    expect(invalidNestedPage).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_NAVIGATION_METADATA',
        message: expect.stringContaining('navigation.sidebar must be "section" or "group"')
      }
    })
  })

  test('validates strict collection schemas against user fields only', () => {
    const document = pathMeta.transform!(
      {
        id: 'content:en:guide:getting-started.md',
        type: 'markdown',
        body: {},
        title: 'Getting Started'
      } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    document.collection = 'docs'

    const outcome = validateCollectionDocument(document, {
      docs: {
        source: 'guide/*.md',
        schema: z.object({
          title: z.string()
        }).strict()
      }
    })

    expect(outcome).toMatchObject({
      ok: true,
      value: expect.objectContaining({
        id: 'content:en:guide:getting-started.md',
        path: '/guide/getting-started',
        title: 'Getting Started'
      })
    })
  })

  test('passes own __proto__ content fields to schemas without changing the input prototype', () => {
    const document = pathMeta.transform!(
      {
        id: 'content:en:guide:getting-started.md',
        type: 'markdown',
        body: {},
        title: 'Getting Started'
      } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    document.collection = 'docs'
    Object.defineProperty(document, '__proto__', {
      value: { source: 'frontmatter' },
      enumerable: true,
      configurable: true,
      writable: true
    })
    let schemaInput: Record<string, unknown> | undefined

    const outcome = validateCollectionDocument(document, {
      docs: {
        source: 'guide/*.md',
        schema: {
          safeParse: (input: Record<string, unknown>) => {
            schemaInput = input
            return { success: true as const, data: input }
          }
        } as any
      }
    })

    expect(outcome.ok).toBe(true)
    expect(Object.getPrototypeOf(schemaInput)).toBe(Object.prototype)
    expect(Object.hasOwn(schemaInput!, '__proto__')).toBe(true)
    expect(schemaInput!.__proto__).toEqual({ source: 'frontmatter' })
  })

  test('still fails strict schema validation for invalid user fields', () => {
    const document = pathMeta.transform!(
      {
        id: 'content:en:guide:getting-started.md',
        type: 'markdown',
        body: {},
        title: 123
      } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    document.collection = 'docs'

    const outcome = validateCollectionDocument(document, {
      docs: {
        source: 'guide/*.md',
        schema: z.object({
          title: z.string()
        }).strict()
      }
    })

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        message: expect.stringContaining('title')
      }
    })
  })

  test('fails strict schema validation for missing nested required fields', () => {
    const document = pathMeta.transform!(
      {
        id: 'content:en:pricing.yml',
        type: 'yaml',
        body: null,
        plans: [
          {
            title: 'Starter',
            price: {
              month: '$9',
              year: '$90'
            }
          }
        ]
      } as any,
      { locales: ['en'], defaultLocale: 'en' }
    )
    document.collection = 'pricing'

    const outcome = validateCollectionDocument(document, {
      pricing: {
        source: 'pricing.yml',
        schema: z.object({
          plans: z.array(z.object({
            title: z.string(),
            billing_period: z.string().nonempty(),
            billing_cycle: z.string().nonempty()
          }))
        })
      }
    })

    expect(outcome).toMatchObject({
      ok: false,
      error: {
        code: 'SCHEMA_VALIDATION_FAILED',
        context: {
          details: expect.stringContaining('plans.0.billing_period')
        },
        message: expect.stringContaining('plans.0.billing_cycle')
      }
    })
  })
})
