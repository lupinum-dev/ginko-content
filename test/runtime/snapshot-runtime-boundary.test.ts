import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../harness/event'
import type { ContentSnapshot } from '../../packages/content/src/core/content/snapshot'
import type { ParsedContent } from '../../packages/content/src/types/content'

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
  version: 1,
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
})
