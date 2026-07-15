import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../harness/event'
import { doc } from '../contracts/_utils'
import { ContentError } from '../../packages/content/src/core/errors'
import { fail, ok } from '../../packages/content/src/core/result'

// `runtime/server/api/cache.ts` is the single
// producer of the canonical content build result and the ONE place
// `snapshot.json` is written. `buildContentResult` (integrations/nitro/build.ts)
// validates documents, the graph, routes, and alternates entirely in memory
// BEFORE the handler ever calls `publishContentSnapshot` — these tests force
// a failure at each of parsing, graph validation, and route derivation, and
// assert `snapshot.json` is never written for any of them, then prove a
// successful build performs exactly one final write.

const mocks = vi.hoisted(() => ({
  getSourceContentIds: vi.fn(),
  loadContentVariants: vi.fn(),
  setItem: vi.fn(),
  validateContentGraph: vi.fn(),
  getContentProvider: vi.fn()
}))

const runtimeContent = {
  collections: {
    docs: { type: 'page' }
  },
  locales: ['en'],
  defaultLocale: 'en',
  translatedSlugs: false,
  sitemap: false,
  validation: 'report',
  cacheIntegrity: 'integrity'
}

vi.mock('../../packages/content/src/integrations/nitro/storage', () => ({
  getSourceContentIds: mocks.getSourceContentIds,
  contentConfig: () => runtimeContent,
  cacheStorage: () => ({
    setItem: mocks.setItem
  }),
  sourceStorage: () => ({ hasItem: vi.fn(async () => false) })
}))

vi.mock('../../packages/content/src/integrations/nitro/runtime-config', () => ({
  getContentRuntimeConfig: () => ({
    public: { content: { navigation: { fields: [] } } },
    content: runtimeContent
  })
}))

vi.mock('../../packages/content/src/storage/contents', () => ({
  chunksFromArray: function* <T>(items: T[], size: number) {
    for (let index = 0; index < items.length; index += size) {
      yield items.slice(index, index + size)
    }
  },
  loadContentVariants: mocks.loadContentVariants
}))

vi.mock('../../packages/content/src/storage/validation', async () => {
  const actual = await vi.importActual<any>('../../packages/content/src/storage/validation')
  return {
    ...actual,
    validateContentGraph: mocks.validateContentGraph
  }
})

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: mocks.getContentProvider
}))

describe('runtime cache API boundary (atomic publication)', () => {
  beforeEach(() => {
    mocks.getSourceContentIds.mockReset()
    mocks.loadContentVariants.mockReset()
    mocks.setItem.mockReset()
    mocks.validateContentGraph.mockReset()
    mocks.validateContentGraph.mockReturnValue(ok(undefined))
    mocks.getContentProvider.mockReset()
    delete (runtimeContent as { provider?: string }).provider
    runtimeContent.validation = 'report'
  })

  test('a successful build performs exactly one final snapshot.json write', async () => {
    const document = doc({
      id: 'content:docs:intro.md',
      collection: 'docs',
      path: '/docs/intro',
      canonicalKey: 'docs/intro'
    })
    mocks.getSourceContentIds.mockResolvedValue(['content:docs:intro.md'])
    mocks.loadContentVariants.mockResolvedValue([document])

    const handler = (await import('../../packages/content/src/runtime/server/api/cache')).default
    const event = createTestEvent()

    const result = await handler(event)

    expect(mocks.getSourceContentIds).toHaveBeenCalledWith(event)
    expect(mocks.loadContentVariants).toHaveBeenCalledWith(event, 'content:docs:intro.md')
    const snapshotWrites = mocks.setItem.mock.calls.filter(call => call[0] === 'snapshot.json')
    expect(snapshotWrites).toHaveLength(1)
    expect(snapshotWrites[0]![1]).toEqual(expect.objectContaining({
      integrity: 'integrity',
      documentIds: ['content:docs:intro.md'],
      documentSourceIds: ['content:docs:intro.md'],
      documents: [document]
    }))
    expect(mocks.setItem).toHaveBeenCalledWith('validation.json', expect.objectContaining({ version: 1, findings: [] }))
    // The validation report is the only rebuildable diagnostic beside the canonical snapshot.
    expect(mocks.setItem).toHaveBeenCalledTimes(2)
    expect(result).toEqual(expect.objectContaining({
      generatedAt: expect.any(Number),
      documentCount: 1,
      generateTime: expect.any(Number),
      routesByCollection: { docs: 1 }
    }))
  })

  test('strict authored-link validation persists diagnostics but never publishes the snapshot', async () => {
    runtimeContent.validation = 'error'
    const document = doc({
      id: 'content:docs:intro.md',
      collection: 'docs',
      path: '/docs/intro',
      canonicalKey: 'docs/intro',
      body: { type: 'root', children: [{ type: 'element', tag: 'a', props: { href: '/missing' }, children: [] }] }
    })
    mocks.getSourceContentIds.mockResolvedValue(['content:docs:intro.md'])
    mocks.loadContentVariants.mockResolvedValue([document])

    const handler = (await import('../../packages/content/src/runtime/server/api/cache')).default
    await expect(handler(createTestEvent())).rejects.toThrow(/authored content validation failed/)

    expect(mocks.setItem).toHaveBeenCalledWith('validation.json', expect.objectContaining({
      findings: [expect.objectContaining({ message: expect.stringContaining('/missing') })]
    }))
    expect(mocks.setItem.mock.calls.some(call => call[0] === 'snapshot.json')).toBe(false)
  })

  test('external providers seed prerender routes through routes() without building a filesystem snapshot', async () => {
    ;(runtimeContent as { provider?: string }).provider = 'cms-demo'
    mocks.getContentProvider.mockResolvedValue({
      name: 'cms-demo',
      routes: vi.fn(async () => [
        { collection: 'docs', canonicalKey: 'docs/guide', locale: 'en', contentPath: '/guide' },
        { collection: 'docs', canonicalKey: 'docs/draft', locale: 'en', contentPath: '/draft', draft: true },
        { collection: 'docs', canonicalKey: 'docs/private-map', locale: 'en', contentPath: '/private-map', sitemap: false }
      ])
    })

    const handler = (await import('../../packages/content/src/runtime/server/api/cache')).default
    const result = await handler(createTestEvent())

    expect(mocks.getSourceContentIds).not.toHaveBeenCalled()
    expect(mocks.setItem).not.toHaveBeenCalled()
    expect(result).toEqual(expect.objectContaining({
      documentCount: 0,
      routes: ['/guide', '/private-map'],
      routesByCollection: { docs: 2 },
      sitemapByCollection: { docs: 1 }
    }))
  })

  test('escapes route paths before embedding them in prerender HTML', async () => {
    const { renderContentRouteLinks } = await import('../../packages/content/src/runtime/server/api/cache')

    expect(renderContentRouteLinks(['/docs?x="quoted"&next=<unsafe>'])).toBe(
      '<a href="/docs?x=&quot;quoted&quot;&amp;next=&lt;unsafe&gt;"></a>'
    )
  })

  test('forced failure after parsing (an unreadable source): snapshot.json is never written', async () => {
    mocks.getSourceContentIds.mockResolvedValue(['content:docs:intro.md', 'content:docs:missing.md'])
    mocks.loadContentVariants.mockImplementation(async (_event: unknown, id: string) =>
      id === 'content:docs:intro.md'
        ? [doc({ id: 'content:docs:intro.md', collection: 'docs', path: '/docs/intro', canonicalKey: 'docs/intro' })]
        : [{ id: 'content:docs:missing.md', body: null, missing: true }]
    )

    const handler = (await import('../../packages/content/src/runtime/server/api/cache')).default
    await expect(handler(createTestEvent())).rejects.toThrow('content:docs:missing.md')

    expect(mocks.setItem).not.toHaveBeenCalled()
  })

  test('forced failure during ingest (a schema/parse rejection): snapshot.json is never written', async () => {
    mocks.getSourceContentIds.mockResolvedValue(['content:docs:intro.md', 'content:docs:broken.md'])
    mocks.loadContentVariants.mockImplementation(async (_event: unknown, id: string) => {
      if (id === 'content:docs:broken.md') {
        throw new ContentError('VALIDATION_FAILED', 'Failed to validate parsed content', { files: [id] })
      }
      return [doc({ id: 'content:docs:intro.md', collection: 'docs', path: '/docs/intro', canonicalKey: 'docs/intro' })]
    })

    const handler = (await import('../../packages/content/src/runtime/server/api/cache')).default
    await expect(handler(createTestEvent())).rejects.toThrow('Failed to validate parsed content')

    expect(mocks.setItem).not.toHaveBeenCalled()
  })

  test('forced failure after graph validation: snapshot.json is never written', async () => {
    mocks.getSourceContentIds.mockResolvedValue(['content:docs:intro.md'])
    mocks.loadContentVariants.mockResolvedValue([
      doc({ id: 'content:docs:intro.md', collection: 'docs', path: '/docs/intro', canonicalKey: 'docs/intro' })
    ])
    const graphError = new ContentError('SCHEMA_VALIDATION_FAILED', 'graph validation failed', {})
    mocks.validateContentGraph.mockReturnValue(fail(graphError))

    const handler = (await import('../../packages/content/src/runtime/server/api/cache')).default
    await expect(handler(createTestEvent())).rejects.toBe(graphError)

    expect(mocks.setItem).not.toHaveBeenCalled()
  })

  test('forced failure during route derivation (a route collision): snapshot.json is never written', async () => {
    // Two different canonical documents that project to the same
    // `{locale, path}` public route -- `buildRouteRecords` must fail loudly
    // rather than let one document silently shadow the other.
    mocks.getSourceContentIds.mockResolvedValue(['content:docs:a.md', 'content:docs:b.md'])
    mocks.loadContentVariants.mockImplementation(async (_event: unknown, id: string) =>
      id === 'content:docs:a.md'
        ? [doc({ id: 'content:docs:a.md', collection: 'docs', path: '/docs/collide', canonicalKey: 'docs/a' })]
        : [doc({ id: 'content:docs:b.md', collection: 'docs', path: '/docs/collide', canonicalKey: 'docs/b' })]
    )

    const handler = (await import('../../packages/content/src/runtime/server/api/cache')).default
    await expect(handler(createTestEvent())).rejects.toThrow(/route collision/)

    expect(mocks.setItem).not.toHaveBeenCalled()
  })
})
