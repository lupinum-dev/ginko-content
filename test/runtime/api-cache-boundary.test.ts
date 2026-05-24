import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../harness/event'

const mocks = vi.hoisted(() => ({
  getContentManifest: vi.fn(),
  getContentProvider: vi.fn(),
  setItem: vi.fn()
}))

vi.mock('../../packages/content/src/runtime/server/manifest', () => ({
  getContentManifest: mocks.getContentManifest
}))

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: mocks.getContentProvider
}))

vi.mock('../../packages/content/src/runtime/server/storage-access', () => ({
  cacheStorage: () => ({
    setItem: mocks.setItem
  })
}))

describe('runtime cache API boundary', () => {
  beforeEach(() => {
    mocks.getContentManifest.mockReset()
    mocks.getContentProvider.mockReset()
    mocks.setItem.mockReset()
  })

  test('cache API persists provider navigation without preloading the filesystem manifest', async () => {
    const navigation = [
      { title: 'Docs', _path: '/docs', path: '/docs' }
    ]
    mocks.getContentProvider.mockResolvedValue({
      navigationQuery: vi.fn(async () => navigation)
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/cache')).default
    const event = createTestEvent()

    const result = await handler(event)

    expect(mocks.getContentManifest).not.toHaveBeenCalled()
    expect(mocks.getContentProvider).toHaveBeenCalledWith(event)
    expect(mocks.setItem).toHaveBeenCalledWith('_nav.json', navigation)
    expect(mocks.setItem).toHaveBeenCalledWith('_meta.json', expect.objectContaining({
      generatedAt: expect.any(Number),
      generateTime: expect.any(Number)
    }))
    expect(result).toEqual(expect.objectContaining({
      generatedAt: expect.any(Number),
      generateTime: expect.any(Number),
      contents: [],
      navigation
    }))
  })
})
