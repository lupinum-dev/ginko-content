import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../harness/event'
import type { ContentCacheInvalidateInput } from '../../packages/content/src/public/provider'

/**
 * Behavior suite (T6.2 #5): cache invalidation wiring end-to-end. A mutation
 * (a signed-off revalidation POST) must flow its computed — normalized and
 * deduplicated — tags/paths into the active cache adapter's `invalidate`.
 * Instead of a bare spy we use a *recording adapter* that captures every
 * invalidation, so we can assert the exact payload the wiring produces across
 * successive mutations.
 */

const mocks = vi.hoisted(() => ({
  clearSearchRecordsCache: vi.fn(),
  getContentCacheAdapter: vi.fn(),
  getContentProvider: vi.fn(),
  getContentRuntimeConfig: vi.fn()
}))

vi.mock('../../packages/content/src/runtime/server/cache-adapter', () => ({
  getContentCacheAdapter: mocks.getContentCacheAdapter
}))

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: mocks.getContentProvider
}))

vi.mock('../../packages/content/src/runtime/server/runtime-config', () => ({
  getContentRuntimeConfig: mocks.getContentRuntimeConfig
}))

vi.mock('../../packages/content/src/runtime/server/search', () => ({
  clearSearchRecordsCache: mocks.clearSearchRecordsCache
}))

const createRecordingAdapter = () => {
  const invalidations: ContentCacheInvalidateInput[] = []
  return {
    invalidations,
    adapter: {
      name: 'recording-cache',
      apply: vi.fn(),
      invalidate: async (input: ContentCacheInvalidateInput) => {
        // Record a defensive copy: the handler builds a fresh object per call,
        // but copying guards the assertions from any later mutation.
        invalidations.push({ tags: input.tags, paths: input.paths })
      }
    }
  }
}

const mutate = async (body: Record<string, unknown>) => {
  const handler = (await import('../../packages/content/src/runtime/server/api/revalidate')).default
  const bodyText = JSON.stringify(body)
  const event = {
    ...createTestEvent(),
    method: 'POST',
    node: {
      req: {
        method: 'POST',
        url: '/',
        headers: {
          'content-length': String(bodyText.length),
          'content-type': 'application/json',
          'x-ginko-revalidate-token': 'secret'
        },
        rawBody: bodyText,
        [Symbol.asyncIterator]: async function * () {
          yield Buffer.from(bodyText)
        }
      }
    }
  } as never
  return handler(event)
}

describe('cache invalidation wiring (recording adapter)', () => {
  beforeEach(() => {
    mocks.getContentCacheAdapter.mockReset()
    mocks.clearSearchRecordsCache.mockReset()
    mocks.getContentProvider.mockReset()
    // No provider-level invalidation: the cache adapter is the sole handler.
    mocks.getContentProvider.mockResolvedValue({})
    mocks.getContentRuntimeConfig.mockReset()
    mocks.getContentRuntimeConfig.mockReturnValue({
      content: { revalidate: { token: 'secret', allowUnsigned: true } }
    })
  })

  test('a mutation flows computed tags + paths into adapter.invalidate', async () => {
    const recording = createRecordingAdapter()
    mocks.getContentCacheAdapter.mockResolvedValue(recording.adapter)

    await expect(mutate({
      tags: ['entry:docs:a', 'entry:docs:a', 'entry:docs:b'],
      paths: ['docs/a', '/docs/a', 'docs//b']
    })).resolves.toMatchObject({ ok: true })

    // Exactly one invalidation recorded, carrying deduped tags and
    // normalized + deduped paths (leading slash added, doubles collapsed).
    expect(recording.invalidations).toEqual([
      { tags: ['entry:docs:a', 'entry:docs:b'], paths: ['/docs/a', '/docs/b'] }
    ])
    expect(mocks.clearSearchRecordsCache).toHaveBeenCalledTimes(1)
  })

  test('paths-only and tags-only mutations record with the empty side undefined', async () => {
    const recording = createRecordingAdapter()
    mocks.getContentCacheAdapter.mockResolvedValue(recording.adapter)

    await mutate({ paths: ['/docs/only'] })
    await mutate({ tags: ['tag:only'] })

    expect(recording.invalidations).toEqual([
      { tags: undefined, paths: ['/docs/only'] },
      { tags: ['tag:only'], paths: undefined }
    ])
    expect(mocks.clearSearchRecordsCache).toHaveBeenCalledTimes(2)
  })

  test('successive mutations accumulate in the adapter end-to-end', async () => {
    const recording = createRecordingAdapter()
    mocks.getContentCacheAdapter.mockResolvedValue(recording.adapter)

    await mutate({ paths: ['/a'] })
    await mutate({ paths: ['/b'] })
    await mutate({ tags: ['t'] })

    expect(recording.invalidations.map(i => i.paths ?? i.tags)).toEqual([
      ['/a'],
      ['/b'],
      ['t']
    ])
  })
})
