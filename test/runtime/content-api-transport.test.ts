import { describe, expect, test, vi } from 'vitest'
import { fetchContentApi } from '../../packages/content/src/runtime/app/composables/utils'

vi.mock('#imports', () => ({
  tryUseNuxtApp: () => undefined,
  useCookie: () => ({ value: null }),
  useRequestEvent: () => undefined,
  useRequestFetch: () => vi.fn(),
  useRoute: () => ({ query: {} }),
  useRuntimeConfig: () => ({ public: { content: {} } }),
  useState: () => ({ value: false })
}))

const runtime = { api: { baseURL: '/api/_content' }, integrity: 'test' }

describe('content API transport', () => {
  test('rejects empty responses for first and list queries', async () => {
    const fetcher = vi.fn(async () => undefined)

    await expect(fetchContentApi(
      'query',
      { collection: 'docs', first: true },
      { fetcher, previewToken: null, runtime }
    )).rejects.toThrow('expected a non-empty JSON body')

    await expect(fetchContentApi(
      'query',
      { collection: 'docs', limit: 10 },
      { fetcher, previewToken: null, runtime }
    )).rejects.toThrow('expected a non-empty JSON body')
  })

  test('registers only successful JSON responses with the captured prerender writer', async () => {
    const fetcher = vi.fn(async () => ({ result: [] }))
    const addPrerenderPath = vi.fn()

    await fetchContentApi(
      'navigation',
      { collection: 'docs' },
      { fetcher, previewToken: null, runtime, addPrerenderPath }
    )

    expect(addPrerenderPath).toHaveBeenCalledOnce()
    expect(addPrerenderPath).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/_content\/navigation\//)
    )

    fetcher.mockResolvedValueOnce('<!DOCTYPE html><title>Fallback</title>')
    await expect(fetchContentApi(
      'query',
      { collection: 'docs', first: true },
      { fetcher, previewToken: null, runtime, addPrerenderPath }
    )).rejects.toMatchObject({ statusCode: 404 })

    fetcher.mockResolvedValueOnce(undefined)
    await expect(fetchContentApi(
      'query',
      { collection: 'docs', first: true },
      { fetcher, previewToken: null, runtime, addPrerenderPath }
    )).rejects.toThrow('expected a non-empty JSON body')

    expect(addPrerenderPath).toHaveBeenCalledOnce()
  })
})
