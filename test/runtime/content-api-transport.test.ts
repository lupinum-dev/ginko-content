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

  test('switches to POST with a JSON body when encoded params exceed the GET budget', async () => {
    const fetcher = vi.fn(async () => ({ result: [] }))
    const addPrerenderPath = vi.fn()
    const longTitle = 'x'.repeat(1_600)

    await fetchContentApi(
      'query',
      { collection: 'docs', where: { title: longTitle } },
      { fetcher, previewToken: null, runtime, addPrerenderPath }
    )

    expect(fetcher).toHaveBeenCalledOnce()
    const [request, init] = fetcher.mock.calls[0] as [string, Record<string, unknown>]
    expect(request).toBe('/api/_content/query')
    expect(init.method).toBe('POST')
    expect(init.body).toMatchObject({ collection: 'docs', where: { title: longTitle } })
    // POST requests have no stable URL to register for prerender seeding.
    expect(addPrerenderPath).not.toHaveBeenCalled()

    await fetchContentApi(
      'query',
      { collection: 'docs', limit: 10 },
      { fetcher, previewToken: null, runtime, addPrerenderPath }
    )
    const [, getInit] = fetcher.mock.calls[1] as [string, Record<string, unknown>]
    expect(getInit.method).toBe('GET')
    expect(addPrerenderPath).toHaveBeenCalledOnce()
  })

  test('keeps the preview token header on both transports', async () => {
    const fetcher = vi.fn(async () => ({ result: [] }))

    await fetchContentApi(
      'query',
      { collection: 'docs', first: true },
      { fetcher, previewToken: 'token-1', runtime }
    )
    expect((fetcher.mock.calls[0] as [string, Record<string, unknown>])[1].headers)
      .toMatchObject({ 'x-nuxt-content-preview': 'token-1' })

    await fetchContentApi(
      'query',
      { collection: 'docs', where: { title: 'y'.repeat(1_600) } },
      { fetcher, previewToken: 'token-2', runtime }
    )
    expect((fetcher.mock.calls[1] as [string, Record<string, unknown>])[1].headers)
      .toMatchObject({ 'x-nuxt-content-preview': 'token-2' })
  })
})
