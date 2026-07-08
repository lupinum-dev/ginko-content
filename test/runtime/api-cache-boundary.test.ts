import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../harness/event'

const mocks = vi.hoisted(() => ({
  getContentManifest: vi.fn(),
  getContentProvider: vi.fn(),
  getSourceContentIds: vi.fn(),
  loadContentVariants: vi.fn(),
  setItem: vi.fn()
}))

vi.mock('../../packages/content/src/runtime/server/manifest', () => ({
  getContentManifest: mocks.getContentManifest
}))

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: mocks.getContentProvider
}))

vi.mock('../../packages/content/src/runtime/server/storage-access', () => ({
  contentConfig: () => ({ cacheIntegrity: 'integrity' }),
  getSourceContentIds: mocks.getSourceContentIds,
  cacheStorage: () => ({
    setItem: mocks.setItem
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

describe('runtime cache API boundary', () => {
  beforeEach(() => {
    mocks.getContentManifest.mockReset()
    mocks.getContentProvider.mockReset()
    mocks.getSourceContentIds.mockReset()
    mocks.loadContentVariants.mockReset()
    mocks.setItem.mockReset()
  })

  test('cache API persists a snapshot and provider navigation without preloading the filesystem manifest', async () => {
    const navigation = [
      { title: 'Docs', path: '/docs' }
    ]
    const document = {
      id: 'content:docs:intro.md',
      path: '/docs/intro',
      body: { type: 'root', children: [] }
    }
    mocks.getSourceContentIds.mockResolvedValue(['content:docs:intro.md'])
    mocks.loadContentVariants.mockResolvedValue([document])
    mocks.getContentProvider.mockResolvedValue({
      navigationQuery: vi.fn(async () => navigation)
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/cache')).default
    const event = createTestEvent()

    const result = await handler(event)

    expect(mocks.getContentManifest).not.toHaveBeenCalled()
    expect(mocks.getSourceContentIds).toHaveBeenCalledWith(event)
    expect(mocks.loadContentVariants).toHaveBeenCalledWith(event, 'content:docs:intro.md')
    expect(mocks.getContentProvider).toHaveBeenCalledWith(event)
    expect(mocks.setItem).toHaveBeenCalledWith('snapshot.json', expect.objectContaining({
      integrity: 'integrity',
      documentIds: ['content:docs:intro.md'],
      documentSourceIds: ['content:docs:intro.md'],
      documents: [document]
    }))
    expect(mocks.setItem).toHaveBeenCalledWith('_nav.json', navigation)
    expect(mocks.setItem).toHaveBeenCalledWith('_meta.json', expect.objectContaining({
      documentCount: 1,
      generatedAt: expect.any(Number),
      generateTime: expect.any(Number)
    }))
    expect(result).toEqual(expect.objectContaining({
      documentCount: 1,
      generatedAt: expect.any(Number),
      generateTime: expect.any(Number),
      navigation
    }))
  })

  test('cache API fails before persisting when the snapshot is missing a source document', async () => {
    const document = {
      id: 'content:docs:intro.md',
      path: '/docs/intro',
      body: { type: 'root', children: [] }
    }
    mocks.getSourceContentIds.mockResolvedValue([
      'content:docs:intro.md',
      'content:docs/missing.md'
    ])
    mocks.loadContentVariants.mockImplementation(async (_event, id: string) =>
      id === 'content:docs:intro.md' ? [document] : []
    )
    const handler = (await import('../../packages/content/src/runtime/server/api/cache')).default
    const event = createTestEvent()

    await expect(handler(event)).rejects.toThrow('content:docs/missing.md')

    expect(mocks.getContentProvider).not.toHaveBeenCalled()
    expect(mocks.setItem).not.toHaveBeenCalledWith('snapshot.json', expect.anything())
    expect(mocks.setItem).not.toHaveBeenCalledWith('_nav.json', expect.anything())
    expect(mocks.setItem).not.toHaveBeenCalledWith('_meta.json', expect.anything())
  })
})
