import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createInMemoryProvider } from '../harness/provider'
import { createSaasI18nScenario } from '../harness/scenarios'
import { createTestEvent } from '../harness/event'
import { encodeQueryParams } from '../../packages/content/src/runtime/utils/query'

/**
 * The closed HTTP boundary must reject a malformed request
 * BEFORE either the provider or the lowering step (`createProviderQuery` /
 * `normalizeProviderQueryResponse`) ever runs. This mounts the real handler
 * with both seams spied so an invalid body proves a typed 400 AND that
 * neither spy was ever invoked — a no-dispatch proof at the handler level,
 * not just of the pure validator in isolation.
 */
const mocks = vi.hoisted(() => ({
  getContentProvider: vi.fn(),
  assertConfiguredProviderCollection: vi.fn(),
  createProviderQuery: vi.fn(),
  normalizeProviderQueryResponse: vi.fn()
}))

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: mocks.getContentProvider
}))

vi.mock('../../packages/content/src/runtime/server/provider-query', () => ({
  assertConfiguredProviderCollection: mocks.assertConfiguredProviderCollection,
  createProviderQuery: mocks.createProviderQuery,
  normalizeProviderQueryResponse: mocks.normalizeProviderQueryResponse
}))

describe('runtime API query handler no-dispatch proof', () => {
  const scenario = createSaasI18nScenario()
  const provider = createInMemoryProvider(scenario)

  beforeEach(() => {
    mocks.getContentProvider.mockReset()
    mocks.assertConfiguredProviderCollection.mockReset()
    mocks.createProviderQuery.mockReset()
    mocks.normalizeProviderQueryResponse.mockReset()
    mocks.getContentProvider.mockResolvedValue(provider)
  })

  test('an invalid request body yields a typed 400 without ever dispatching to the provider or the lowerer', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        // Unknown top-level key — rejected by `validateContentQueryRequestBody`
        // before lowering or provider dispatch ever run.
        params: `docs/${encodeQueryParams({ collection: 'docs', hackAttempt: true } as never)}`
      }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 400,
      data: expect.objectContaining({ code: 'invalid_content_query_request' })
    })

    expect(mocks.getContentProvider).not.toHaveBeenCalled()
    expect(mocks.createProviderQuery).not.toHaveBeenCalled()
    expect(mocks.normalizeProviderQueryResponse).not.toHaveBeenCalled()
  })

  test.each([
    {
      name: 'cursor paging plus top-level skip',
      request: { skip: 5, paging: { mode: 'cursor', after: 'opaque-cursor-value', limit: 10 } },
      path: '$.skip'
    },
    {
      name: 'offset paging plus top-level limit',
      request: { limit: 5, paging: { mode: 'offset', skip: 0, limit: 10 } },
      path: '$.limit'
    },
    {
      name: 'invalid sort locale',
      request: { sort: [{ title: 1, $locale: 'not_a_locale' }] },
      path: '$.sort[0].$locale'
    },
    {
      name: 'zero offset page limit',
      request: { paging: { mode: 'offset', skip: 0, limit: 0 } },
      path: '$.paging.limit'
    },
    {
      name: 'zero cursor page limit',
      request: { paging: { mode: 'cursor', after: null, limit: 0 } },
      path: '$.paging.limit'
    },
    {
      name: 'empty logical group',
      request: { where: [{ $or: [] }] },
      path: '$.where[0].$or'
    },
    {
      name: 'mixed operator and nested-field object',
      request: { where: [{ status: { $eq: 'draft', nested: true } }] },
      path: '$.where[0].status'
    }
  ])('rejects $name before dispatch', async ({ request, path }) => {
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({
          collection: 'docs',
          ...request
        } as never)}`
      }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 400,
      data: expect.objectContaining({ code: 'invalid_content_query_request', path })
    })

    expect(mocks.getContentProvider).not.toHaveBeenCalled()
    expect(mocks.createProviderQuery).not.toHaveBeenCalled()
    expect(mocks.normalizeProviderQueryResponse).not.toHaveBeenCalled()
  })

  test('the public query endpoint requires a collection before provider dispatch', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `query/${encodeQueryParams({ limit: 10 } as never)}`
      }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 400,
      data: expect.objectContaining({
        code: 'invalid_content_query_request',
        path: '$.collection'
      })
    })

    expect(mocks.getContentProvider).not.toHaveBeenCalled()
    expect(mocks.createProviderQuery).not.toHaveBeenCalled()
    expect(mocks.normalizeProviderQueryResponse).not.toHaveBeenCalled()
  })

  test('contradictory terminal modes are rejected before lowering or provider dispatch', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    for (const request of [
      { collection: 'docs', first: true, count: true },
      { collection: 'docs', first: true, paging: { mode: 'offset', skip: 0, limit: 10 } }
    ]) {
      const event = createTestEvent({
        scenario,
        provider,
        params: { params: `query/${encodeQueryParams(request as never)}` }
      })
      await expect(handler(event)).rejects.toMatchObject({
        statusCode: 400,
        data: expect.objectContaining({ code: 'invalid_content_query_request' })
      })
    }

    expect(mocks.getContentProvider).not.toHaveBeenCalled()
    expect(mocks.createProviderQuery).not.toHaveBeenCalled()
    expect(mocks.normalizeProviderQueryResponse).not.toHaveBeenCalled()
  })
})
