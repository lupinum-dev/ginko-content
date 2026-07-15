import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createInMemoryProvider } from '../harness/provider'
import { createSaasI18nScenario } from '../harness/scenarios'
import { createTestEvent } from '../harness/event'
import { encodeQueryParams } from '../../packages/content/src/runtime/utils/query'

const mocks = vi.hoisted(() => ({
  getContentProvider: vi.fn()
}))

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: mocks.getContentProvider
}))

describe('runtime API provider boundary', () => {
  const scenario = createSaasI18nScenario()
  const provider = createInMemoryProvider(scenario)

  beforeEach(() => {
    mocks.getContentProvider.mockReset()
    mocks.getContentProvider.mockResolvedValue(provider)
  })

  test('query API decodes request params and dispatches through the provider contract', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({
          collection: 'docs',
          resolveVariant: {
            route: '/de/dokumentation/essentials/fallback-lab',
            locale: 'de',
            fallback: ['en']
          },
          first: true
        } as never)}`
      }
    })

    await expect(handler(event)).resolves.toMatchObject({
      result: {
        title: 'Fallback Lab',
        route: {
          requestedPath: '/de/dokumentation/essentials/fallback-lab',
          resolvedPath: '/docs/essentials/fallback-lab'
        },
        resolution: {
          resolved: { locale: 'en' },
          usedFallback: true
        }
      }
    })
    expect(mocks.getContentProvider).toHaveBeenCalledWith(event)
  })

  test('query API validates canonical provider responses at the handler boundary', async () => {
    const query = vi.fn(async () => ({
      result: [{
        collection: 'docs',
        canonicalKey: 'docs:intro',
        locale: 'en',
        contentPath: '/docs/intro',
        body: { type: 'root', children: [] },
        title: 'Intro'
      }],
      skip: 0,
      limit: 10,
      total: 1
    }))
    mocks.getContentProvider.mockResolvedValue({
      ...provider,
      query
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({
          collection: 'docs',
          limit: 10
        } as never)}`
      }
    })

    await expect(handler(event)).resolves.toEqual({
      result: [expect.objectContaining({
        title: 'Intro',
        route: expect.objectContaining({ resolvedPath: '/docs/intro' }),
        resolution: expect.objectContaining({ resolved: { locale: 'en' } })
      })],
      skip: 0,
      limit: 10,
      total: 1
    })
    expect(query).toHaveBeenCalledWith(event, expect.objectContaining({
      v: 2,
      collection: 'docs',
      plan: expect.objectContaining({ collection: 'docs', limit: 10 })
    }))
  })

  test('query API rejects malformed provider responses at the handler boundary', async () => {
    mocks.getContentProvider.mockResolvedValue({
      ...provider,
      query: vi.fn(async () => 2)
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({
          collection: 'docs'
        } as never)}`
      }
    })

    await expect(handler(event)).rejects.toMatchObject({
      data: expect.objectContaining({ code: 'provider_result_invalid' })
    })
  })

  test('navigation API keeps query-string collection and locale adaptation at the handler seam', async () => {
    const navigation = vi.fn(async () => [])
    mocks.getContentProvider.mockResolvedValue({
      ...provider,
      navigation
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/navigation')).default
    const event = createTestEvent({
      scenario,
      provider,
      query: {
        collection: 'docs',
        locale: 'de'
      }
    })

    await expect(handler(event)).resolves.toEqual([])
    expect(mocks.getContentProvider).toHaveBeenCalledWith(event)
    expect(navigation).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ v: 2, collection: 'docs', plan: expect.objectContaining({ collection: 'docs' }) }),
      expect.objectContaining({ locale: 'de' })
    )
  })

  test('server surround uses the provider surroundings operation when available', async () => {
    vi.stubGlobal('__ginkoTestRuntimeConfig', { content: scenario.runtime })
    const surroundings = vi.fn(provider.surroundings!.bind(provider))
    mocks.getContentProvider.mockResolvedValue({ ...provider, surroundings })
    const { surround } = await import('../../packages/content/src/runtime/server/query-api')
    const event = createTestEvent({ scenario, provider })

    await expect(surround(event, 'docs', {
      by: { route: '/de/dokumentation/erste-schritte' },
      locale: 'de',
      fallback: true
    })).resolves.toEqual({
      previous: null,
      next: expect.objectContaining({
        title: 'Markdown Syntax DE',
        path: '/de/dokumentation/grundlagen/markdown-syntax'
      })
    })
    expect(surroundings).toHaveBeenCalledWith(
      event,
      'docs',
      '/dokumentation/erste-schritte',
      expect.objectContaining({ locale: 'de' })
    )
  })
})
