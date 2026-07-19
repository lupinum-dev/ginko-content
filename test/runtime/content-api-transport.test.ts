import { describe, expect, test, vi } from 'vitest'
import { fetchContentApi } from '../../packages/content/src/runtime/app/composables/utils'

vi.mock('#imports', () => ({
  useCookie: () => ({ value: null }),
  useRequestEvent: () => undefined,
  useRequestFetch: () => vi.fn(),
  useRoute: () => ({ query: {} }),
  useRuntimeConfig: () => ({ public: { content: {} } }),
  useState: () => ({ value: false })
}))

const runtime = { api: { baseURL: '/api/_content' }, integrity: 'test' }

describe('content API transport', () => {
  test('normalizes Nitro empty responses to null only for missing first queries', async () => {
    const fetcher = vi.fn(async () => undefined)

    await expect(fetchContentApi(
      'query',
      { collection: 'docs', first: true },
      { fetcher, previewToken: null, runtime }
    )).resolves.toBeNull()

    await expect(fetchContentApi(
      'query',
      { collection: 'docs', limit: 10 },
      { fetcher, previewToken: null, runtime }
    )).resolves.toBeUndefined()
  })
})
