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
        _resolvedLocale: 'en',
        _fallback: true
      }
    })
    expect(mocks.getContentProvider).toHaveBeenCalledWith(event)
  })

  test('query API validates canonical provider responses at the handler boundary', async () => {
    const query = vi.fn(async () => ({
      result: [{ title: 'Intro' }],
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
      result: [{ title: 'Intro' }],
      skip: 0,
      limit: 10,
      total: 1
    })
    expect(query).toHaveBeenCalledWith(event, {
      collection: 'docs',
      limit: 10
    })
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
    const navigationQuery = vi.fn(async () => [])
    mocks.getContentProvider.mockResolvedValue({
      ...provider,
      navigationQuery
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
    expect(navigationQuery).toHaveBeenCalledWith(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de' }
    })
  })
})
