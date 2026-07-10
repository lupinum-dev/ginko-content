import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createInMemoryProvider } from '../harness/provider'
import { createSaasI18nScenario } from '../harness/scenarios'
import { createTestEvent } from '../harness/event'
import { encodeQueryParams } from '../../packages/content/src/runtime/utils/query'

/**
 * VNEXT.md 20.6: the closed HTTP boundary must reject a malformed request
 * BEFORE either the provider or the lowering step (`createProviderQuery` /
 * `normalizeProviderQueryResponse`) ever runs. This mounts the real handler
 * with both seams spied so an invalid body proves a typed 400 AND that
 * neither spy was ever invoked — a no-dispatch proof at the handler level,
 * not just of the pure validator in isolation.
 */
const mocks = vi.hoisted(() => ({
  getContentProvider: vi.fn(),
  createProviderQuery: vi.fn(),
  normalizeProviderQueryResponse: vi.fn()
}))

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: mocks.getContentProvider
}))

vi.mock('../../packages/content/src/runtime/server/provider-query', () => ({
  createProviderQuery: mocks.createProviderQuery,
  normalizeProviderQueryResponse: mocks.normalizeProviderQueryResponse
}))

describe('runtime API query handler no-dispatch proof', () => {
  const scenario = createSaasI18nScenario()
  const provider = createInMemoryProvider(scenario)

  beforeEach(() => {
    mocks.getContentProvider.mockReset()
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

  test('a request combining top-level `skip` with cursor paging is also rejected before dispatch', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({
          collection: 'docs',
          skip: 5,
          paging: { mode: 'cursor', after: 'opaque-cursor-value', limit: 10 }
        } as never)}`
      }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 400,
      data: expect.objectContaining({ code: 'invalid_content_query_request', path: '$.skip' })
    })

    expect(mocks.getContentProvider).not.toHaveBeenCalled()
    expect(mocks.createProviderQuery).not.toHaveBeenCalled()
    expect(mocks.normalizeProviderQueryResponse).not.toHaveBeenCalled()
  })
})
