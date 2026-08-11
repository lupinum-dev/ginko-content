import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../support/provider-scenarios/event'
import { CONTENT_SNAPSHOT_VERSION, type ContentSnapshot } from '../../packages/content/src/core/content/snapshot'
import type { ParsedContent } from '../../packages/content/src/types/content'
import { encodeQueryParams } from '../../packages/content/src/runtime/utils/query'

const runtimeContent = {
  sources: {},
  defaultLocale: 'en',
  locales: ['en'],
  translatedSlugs: false,
  strictTranslatedSlugs: false,
  respectPathCase: false,
  cacheVersion: 'v1',
  cacheIntegrity: 'integrity',
  ignores: [],
  collections: {}
}

const document = (overrides: Partial<ParsedContent> = {}): ParsedContent => ({
  id: 'content:docs:intro.md',
  path: '/docs/intro',
  file: { source: 'content', path: '/docs/intro.md' },
  type: 'markdown',
  locale: 'en',
  canonicalKey: 'docs/intro',
  title: 'Intro',
  body: { type: 'root', children: [] },
  ...overrides
}) as ParsedContent

const snapshot = (overrides: Partial<ContentSnapshot> = {}): ContentSnapshot => ({
  version: CONTENT_SNAPSHOT_VERSION,
  integrity: 'integrity',
  generatedAt: 1,
  documentIds: ['content:docs:intro.md'],
  documentSourceIds: ['content:docs:intro.md'],
  documents: [document()],
  ...overrides
})

const stubRuntime = (getItem: ReturnType<typeof vi.fn>) => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubGlobal('__ginkoTestRuntimeConfig', { content: runtimeContent })
  vi.stubGlobal('__ginkoTestStorage', {
    getItem,
    setItem: vi.fn(),
    getKeys: vi.fn(async () => []),
    removeItem: vi.fn()
  })
}

describe('production snapshot runtime', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('reuses one graph object across sequential production requests', async () => {
    const getItem = vi.fn(async () => snapshot())
    stubRuntime(getItem)
    const { getContentGraph } = await import('../../packages/content/src/storage/graph')
    const { getContentsList } = await import('../../packages/content/src/storage/contents')

    const first = await getContentGraph(createTestEvent())
    const second = await getContentGraph(createTestEvent())
    const documents = await getContentsList(createTestEvent(), 'content:docs:')

    expect(second).toBe(first)
    expect(documents).toEqual(first.documents)
    expect(getItem).toHaveBeenCalledTimes(1)
  })

  test('deduplicates concurrent production snapshot loads', async () => {
    let release!: (value: ContentSnapshot) => void
    const getItem = vi.fn(() => new Promise<ContentSnapshot>((resolve) => {
      release = resolve
    }))
    stubRuntime(getItem)
    const { getContentGraph } = await import('../../packages/content/src/storage/graph')

    const firstPending = getContentGraph(createTestEvent())
    const secondPending = getContentGraph(createTestEvent())
    release(snapshot())

    const [first, second] = await Promise.all([firstPending, secondPending])
    expect(second).toBe(first)
    expect(getItem).toHaveBeenCalledTimes(1)
  })

  test('reloads the production snapshot when cache integrity changes', async () => {
    const contentConfig = { ...runtimeContent }
    let storedSnapshot = snapshot()
    const getItem = vi.fn(async () => storedSnapshot)
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubGlobal('__ginkoTestRuntimeConfig', { content: contentConfig })
    vi.stubGlobal('__ginkoTestStorage', {
      getItem,
      setItem: vi.fn(),
      getKeys: vi.fn(async () => []),
      removeItem: vi.fn()
    })
    const { getContentGraph } = await import('../../packages/content/src/storage/graph')

    const first = await getContentGraph(createTestEvent())
    contentConfig.cacheIntegrity = 'integrity-v2'
    storedSnapshot = snapshot({ integrity: 'integrity-v2' })
    const second = await getContentGraph(createTestEvent())

    expect(second).not.toBe(first)
    expect(getItem).toHaveBeenCalledTimes(2)
  })

  test('resets the process snapshot state after a failed first load', async () => {
    const getItem = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(snapshot())
    stubRuntime(getItem)
    const { getContentGraph } = await import('../../packages/content/src/storage/graph')

    await expect(getContentGraph(createTestEvent())).rejects.toThrow('production snapshot missing or invalid')
    await expect(getContentGraph(createTestEvent())).resolves.toMatchObject({
      byId: expect.objectContaining({
        'content:docs:intro.md': expect.any(Object)
      })
    })
    expect(getItem).toHaveBeenCalledTimes(2)
  })

  test('fails loudly when the production snapshot integrity is stale', async () => {
    const getItem = vi.fn(async () => snapshot({ integrity: 'old-integrity' }))
    stubRuntime(getItem)
    const { getContentGraph } = await import('../../packages/content/src/storage/graph')

    await expect(getContentGraph(createTestEvent())).rejects.toThrow('snapshot integrity mismatch')
  })

  // Filesystem production preview is unsupported and
  // must fail before the sealed snapshot is even read — not silently expose
  // it, and not silently ignore the preview token either.
  describe('production preview against the filesystem provider', () => {
    const previewEvent = () => createTestEvent({
      headers: { 'x-nuxt-content-preview': 'secret' },
      context: {}
    })

    const stubPreviewRuntime = (getItem: ReturnType<typeof vi.fn>) => {
      vi.stubEnv('NODE_ENV', 'production')
      vi.stubGlobal('__ginkoTestRuntimeConfig', {
        content: { ...runtimeContent, preview: { token: 'secret' } }
      })
      vi.stubGlobal('__ginkoTestStorage', {
        getItem,
        setItem: vi.fn(),
        getKeys: vi.fn(async () => []),
        removeItem: vi.fn()
      })
    }

    test('getContentGraph rejects an authenticated preview request before reading the snapshot', async () => {
      const getItem = vi.fn(async () => snapshot())
      stubPreviewRuntime(getItem)
      const { getContentGraph } = await import('../../packages/content/src/storage/graph')

      await expect(getContentGraph(previewEvent())).rejects.toMatchObject({
        statusCode: 400,
        statusMessage: 'unsupported_filesystem_preview',
        data: expect.objectContaining({ code: 'unsupported_filesystem_preview', provider: 'filesystem' })
      })
      // Query dispatch never touched the sealed snapshot storage.
      expect(getItem).not.toHaveBeenCalled()
    })

    test('an invalid preview token fails closed before reading the sealed snapshot', async () => {
      const getItem = vi.fn(async () => snapshot())
      stubPreviewRuntime(getItem)
      const { getContentGraph } = await import('../../packages/content/src/storage/graph')

      const wrongTokenEvent = createTestEvent({
        headers: { 'x-nuxt-content-preview': 'not-it' }
      })
      await expect(getContentGraph(wrongTokenEvent)).rejects.toMatchObject({
        statusCode: 401,
        statusMessage: 'invalid_preview_token'
      })
      expect(getItem).not.toHaveBeenCalled()
    })

    test('rejects query-string preview credentials', async () => {
      const getItem = vi.fn(async () => snapshot())
      stubPreviewRuntime(getItem)
      const { isPreview } = await import('../../packages/content/src/integrations/nitro/preview')

      expect(() => isPreview(createTestEvent({ query: { previewToken: 'secret' } }))).toThrowError(
        expect.objectContaining({ statusCode: 400, statusMessage: 'invalid_preview_transport' }),
      )
    })

    test('marks every authorized preview response private and non-cacheable', async () => {
      const getItem = vi.fn(async () => snapshot())
      stubPreviewRuntime(getItem)
      const middleware = (await import('../../packages/content/src/runtime/server/middleware/preview')).default
      const event = previewEvent()

      await middleware(event)
      expect(event.responseHeaders.get('cache-control')).toBe('private, no-store')
    })

    test('a valid preview token in development is unaffected by the guard', async () => {
      const getItem = vi.fn(async () => snapshot())
      vi.stubEnv('NODE_ENV', 'development')
      vi.stubGlobal('__ginkoTestRuntimeConfig', {
        content: { ...runtimeContent, preview: { token: 'secret' } }
      })
      vi.stubGlobal('__ginkoTestStorage', {
        getItem,
        setItem: vi.fn(),
        getKeys: vi.fn(async () => []),
        removeItem: vi.fn()
      })
      const { getContentGraph } = await import('../../packages/content/src/storage/graph')

      // Development never uses the process snapshot at all (usesProcessSnapshot
      // is production-only), so this must not throw and must not read
      // `snapshot.json` — it takes the dev content-list path instead.
      await expect(getContentGraph(previewEvent())).resolves.toBeTruthy()
      expect(getItem).not.toHaveBeenCalled()
    })
  })

  // The same guard also protects the untrusted public HTTP query boundary
  // directly, independent of the
  // `getContentGraph` guard exercised above.
  test('the public query executor rejects an authenticated production preview request before query dispatch', async () => {
    const getItem = vi.fn(async () => snapshot())
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubGlobal('__ginkoTestRuntimeConfig', {
      content: { ...runtimeContent, preview: { token: 'secret' } }
    })
    vi.stubGlobal('__ginkoTestStorage', {
      getItem,
      setItem: vi.fn(),
      getKeys: vi.fn(async () => []),
      removeItem: vi.fn()
    })
    const { executeFilesystemContentQuery } = await import('../../packages/content/src/runtime/server/query-executor')
    const { toContentProviderQuery } = await import('../../packages/content/src/public/provider-query')

    const plan = toContentProviderQuery({ collection: 'docs' }).plan
    const previewEvent = createTestEvent({ headers: { 'x-nuxt-content-preview': 'secret' } })
    await expect(executeFilesystemContentQuery(previewEvent, plan)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'unsupported_filesystem_preview'
    })
    expect(getItem).not.toHaveBeenCalled()
  })

  test('the public query API surfaces malformed filesystem cursors as a typed 400 instead of restarting page one', async () => {
    const getItem = vi.fn(async () => snapshot({
      documents: [document({ collection: 'docs' })]
    }))
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubGlobal('__ginkoTestRuntimeConfig', {
      content: {
        ...runtimeContent,
        collections: { docs: {} }
      }
    })
    vi.stubGlobal('__ginkoTestStorage', {
      getItem,
      setItem: vi.fn(),
      getKeys: vi.fn(async () => []),
      removeItem: vi.fn()
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      params: {
        params: `docs/${encodeQueryParams({
          collection: 'docs',
          paging: { mode: 'cursor', after: 'not-a-filesystem-cursor', limit: 1 }
        } as never)}`
      }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({
        code: 'unsupported_query_shape',
        provider: 'filesystem',
        field: 'paging.after'
      })
    })
  })
})
