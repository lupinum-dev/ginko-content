import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createInMemoryProvider } from '../harness/provider'
import { createBasicScenario, createSaasI18nScenario } from '../harness/scenarios'
import { createTestEvent } from '../harness/event'
import { encodeQueryParams } from '../../packages/content/src/runtime/utils/query'
import {
  MAX_QUERY_REQUEST_BYTES,
  MAX_STRING_OPERAND_LENGTH
} from '../../packages/content/src/runtime/server/query-http-validation'

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
    vi.stubGlobal('__ginkoTestRuntimeConfig', { content: scenario.runtime })
    mocks.getContentProvider.mockReset()
    mocks.getContentProvider.mockResolvedValue(provider)
  })

  test('query API decodes request params and dispatches through the provider contract', async () => {
    const query = vi.fn(provider.query.bind(provider))
    mocks.getContentProvider.mockResolvedValue({ ...provider, query })
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
          resolvedPath: '/docs/essentials/fallback-lab',
          alternates: [
            {
              locale: 'en',
              path: '/docs/essentials/fallback-lab',
              source: 'variant'
            },
            {
              locale: 'de',
              path: '/de/dokumentation/essentials/fallback-lab',
              source: 'fallback',
              resolvedLocale: 'en'
            }
          ]
        },
        resolution: {
          resolved: { locale: 'en' },
          usedFallback: true
        }
      }
    })
    expect(mocks.getContentProvider).toHaveBeenCalledWith(event)
    expect(query).toHaveBeenCalledWith(event, expect.objectContaining({
      plan: expect.objectContaining({
        variantSelector: {
          by: 'route',
          requestedLocale: 'de',
          candidates: [
            { locale: 'de', contentPath: '/essentials/fallback-lab' },
            { locale: 'en', contentPath: '/essentials/fallback-lab' }
          ]
        }
      })
    }))
  })

  test('query API rejects non-own collection names before external-provider lookup or dispatch', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `query/${encodeQueryParams({ collection: 'constructor', limit: 10 } as never)}`
      }
    })

    let thrown: unknown
    try {
      await handler(event)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      statusCode: 400,
      statusMessage: 'invalid_content_query_request',
      data: {
        code: 'invalid_content_query_request',
        path: '$.collection',
        reason: 'collection must name a configured content collection.'
      }
    })
    expect(JSON.stringify(thrown)).not.toContain('constructor')
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('query API serializes a missing first result in the public envelope', async () => {
    const query = vi.fn(async () => ({ result: undefined }))
    mocks.getContentProvider.mockResolvedValue({ ...provider, query })
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({
          collection: 'docs',
          first: true
        } as never)}`
      }
    })

    const response = await handler(event)
    expect(response).toEqual({ result: null })
    expect(JSON.stringify(response)).toBe('{"result":null}')
    expect(query).toHaveBeenCalledOnce()
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
        route: expect.objectContaining({
          resolvedPath: '/docs/intro',
          alternates: [{ locale: 'en', path: '/docs/intro', source: 'variant' }]
        }),
        resolution: expect.objectContaining({ resolved: { locale: 'en' } })
      })],
      skip: 0,
      limit: 10,
      total: 1
    })
    expect(query).toHaveBeenCalledWith(event, expect.objectContaining({
      v: 3,
      collection: 'docs',
      plan: expect.objectContaining({
        collection: 'docs',
        pagination: { mode: 'slice', skip: 0, limit: 10 }
      })
    }))
  })

  test('query API applies `without` after provider document shaping', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({
          collection: 'docs',
          without: ['body'],
          limit: 1
        } as never)}`
      }
    })

    const response = await handler(event) as { result: Array<Record<string, unknown>> }
    expect(response.result).toHaveLength(1)
    expect(response.result[0]).not.toHaveProperty('body')
    expect(response.result[0]).toEqual(expect.objectContaining({
      collection: 'docs',
      route: expect.any(Object),
      resolution: expect.any(Object)
    }))
  })

  test('internal search leaves draft and locale visibility to providers for an unlocalized collection', async () => {
    const basicScenario = createBasicScenario()
    const fixtureProvider = createInMemoryProvider(basicScenario)
    const query = vi.fn(fixtureProvider.query.bind(fixtureProvider))
    const { enforceProviderCapabilities } = await vi.importActual<typeof import('../../packages/content/src/runtime/server/providers')>(
      '../../packages/content/src/runtime/server/providers'
    )
    const providerWithoutNe = enforceProviderCapabilities({
      ...fixtureProvider,
      capabilities: {
        query: {
          operators: ['$eq'],
          pagination: []
        }
      },
      query
    })
    vi.stubGlobal('__ginkoTestRuntimeConfig', { content: basicScenario.runtime })
    mocks.getContentProvider.mockResolvedValue(providerWithoutNe)
    const { buildSearchIndex } = await import('../../packages/content/src/runtime/server/search')
    const event = createTestEvent({ scenario: basicScenario, provider: providerWithoutNe })

    const records = await buildSearchIndex(event, { collections: ['posts'] })

    expect(records.map(record => record.title)).toEqual(['Hello World', 'Second Post'])
    expect(query).toHaveBeenCalledTimes(1)
    const dispatchedFilter = query.mock.calls[0]![1].plan.filter
    expect(dispatchedFilter).toEqual({ type: 'true' })
    expect(JSON.stringify(dispatchedFilter)).not.toContain('draft')
    expect(JSON.stringify(dispatchedFilter)).not.toContain('"operator":"ne"')
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

  test('query API rejects provider document paths outside the raw route contract', async () => {
    mocks.getContentProvider.mockResolvedValue({
      ...provider,
      query: vi.fn(async () => ({
        result: [{
          collection: 'docs',
          locale: 'en',
          contentPath: 'https://evil.test/docs/intro',
          body: { type: 'root', children: [] }
        }],
        skip: 0,
        limit: 10,
        total: 1
      }))
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({ collection: 'docs', limit: 10 } as never)}`
      }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusMessage: 'provider_result_invalid',
      data: expect.objectContaining({
        code: 'provider_result_invalid',
        operation: 'query',
        field: 'result'
      })
    })
  })

  test('query API requires a provider canonical key for localized collections', async () => {
    mocks.getContentProvider.mockResolvedValue({
      ...provider,
      query: vi.fn(async () => ({
        result: [{
          collection: 'docs',
          locale: 'en',
          contentPath: '/docs/intro',
          body: { type: 'root', children: [] }
        }],
        skip: 0,
        limit: 10,
        total: 1
      }))
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({ collection: 'docs', limit: 10 } as never)}`
      }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusMessage: 'provider_result_invalid',
      data: expect.objectContaining({ operation: 'query', field: 'result' })
    })
  })

  test('query API does not localize a collection that did not opt in', async () => {
    vi.stubGlobal('__ginkoTestRuntimeConfig', {
      content: {
        defaultLocale: 'en',
        locales: ['en', 'de'],
        collections: {
          docs: {
            localePolicy: {
              localized: false,
              locales: [],
              fallback: {},
              translatedSlugs: false,
              routeMounts: { default: '/docs' }
            }
          }
        }
      }
    })
    mocks.getContentProvider.mockResolvedValue({
      ...provider,
      query: vi.fn(async () => ({
        result: [{
          collection: 'docs',
          locale: 'en',
          contentPath: '/docs/intro',
          body: { type: 'root', children: [] }
        }],
        skip: 0,
        limit: 10,
        total: 1
      }))
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({ collection: 'docs', limit: 10 } as never)}`
      }
    })

    await expect(handler(event)).resolves.toMatchObject({
      result: [{
        locale: 'en',
        route: {
          resolvedPath: '/docs/intro',
          alternates: []
        }
      }]
    })
  })

  test('query API does not invent localized variants when collection i18n is disabled', async () => {
    vi.stubGlobal('__ginkoTestRuntimeConfig', {
      content: {
        defaultLocale: 'en',
        locales: ['en', 'de'],
        collections: {
          docs: {
            i18n: false,
            route: '/docs',
            localePolicy: {
              localized: false,
              locales: [],
              fallback: {},
              translatedSlugs: false,
              routeMounts: { default: '/docs' }
            }
          }
        }
      }
    })
    mocks.getContentProvider.mockResolvedValue({
      ...provider,
      query: vi.fn(async () => ({
        result: [{
          collection: 'docs',
          canonicalKey: 'docs:intro',
          locale: 'en',
          contentPath: '/docs/intro',
          routeVariants: [
            { locale: 'en', contentPath: '/docs/intro' },
            { locale: 'de', contentPath: '/dokumentation/einstieg' }
          ],
          body: { type: 'root', children: [] }
        }],
        skip: 0,
        limit: 10,
        total: 1
      }))
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({ collection: 'docs', limit: 10 } as never)}`
      }
    })

    await expect(handler(event)).resolves.toMatchObject({
      result: [{
        route: { resolvedPath: '/docs/intro', alternates: [] },
        resolution: { requested: {}, resolved: { locale: 'en' }, usedFallback: false }
      }]
    })
  })

  test('query API rejects provider locales outside collection policy', async () => {
    mocks.getContentProvider.mockResolvedValue({
      ...provider,
      query: vi.fn(async () => ({
        result: [{
          collection: 'docs',
          canonicalKey: 'docs:intro',
          locale: 'fr',
          contentPath: '/fr/docs/intro',
          body: { type: 'root', children: [] }
        }],
        skip: 0,
        limit: 10,
        total: 1
      }))
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({ collection: 'docs', limit: 10 } as never)}`
      }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusMessage: 'provider_result_invalid',
      data: expect.objectContaining({ operation: 'query', field: 'result' })
    })
  })

  test('query API rejects documents from outside the requested collection', async () => {
    mocks.getContentProvider.mockResolvedValue({
      ...provider,
      query: vi.fn(async () => ({
        result: [{
          collection: 'posts',
          locale: 'en',
          contentPath: '/blog/wrong-collection',
          body: { type: 'root', children: [] }
        }],
        skip: 0,
        limit: 10,
        total: 1
      }))
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({ collection: 'docs', limit: 10 } as never)}`
      }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusMessage: 'provider_result_invalid',
      data: expect.objectContaining({ field: 'result.collection' })
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
      expect.objectContaining({ v: 3, collection: 'docs', plan: expect.objectContaining({ collection: 'docs' }) }),
      expect.objectContaining({ locale: 'de' })
    )
  })

  test('navigation API preserves cross-collection navigation when collection is omitted', async () => {
    const navigation = vi.fn(async () => [])
    mocks.getContentProvider.mockResolvedValue({
      ...provider,
      navigation
    })
    const handler = (await import('../../packages/content/src/runtime/server/api/navigation')).default
    const event = createTestEvent({ scenario, provider })

    await expect(handler(event)).resolves.toEqual([])
    expect(navigation).toHaveBeenCalledWith(
      event,
      expect.objectContaining({ v: 3, collection: null }),
      {}
    )
  })

  test('navigation API rejects non-own collection names before external-provider lookup or dispatch', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/navigation')).default
    const event = createTestEvent({
      scenario,
      provider,
      query: { collection: 'constructor' }
    })

    let thrown: unknown
    try {
      await handler(event)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      statusCode: 400,
      statusMessage: 'invalid_content_query_request',
      data: {
        code: 'invalid_content_query_request',
        path: '$.collection',
        reason: 'collection must name a configured content collection.'
      }
    })
    expect(JSON.stringify(thrown)).not.toContain('constructor')
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('navigation API rejects invalid query regex payloads before provider dispatch', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/navigation')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: `navigation/${encodeQueryParams({
          collection: 'docs',
          where: [{ title: { $regex: 'x'.repeat(MAX_STRING_OPERAND_LENGTH + 1) } }]
        } as never)}`
      }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 400,
      data: expect.objectContaining({
        code: 'invalid_content_query_request',
        path: '$.where[0].title.$regex'
      })
    })
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('navigation API rejects oversized encoded queries before decoding or provider dispatch', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/navigation')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: {
        params: 'x'.repeat(MAX_QUERY_REQUEST_BYTES + 1)
      }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 400,
      data: expect.objectContaining({ code: 'invalid_content_query_request', path: '$' })
    })
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('navigation API rejects requested locales outside collection policy before provider dispatch', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/navigation')).default
    const event = createTestEvent({
      scenario,
      provider,
      query: { collection: 'docs', locale: 'fr' }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({ field: 'resolveLocale.locale' })
    })
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('navigation API rejects provider route facts outside the requested collection', async () => {
    const navigation = vi.fn(async () => [{
      title: 'Wrong collection',
      route: {
        collection: 'posts',
        canonicalKey: 'posts:wrong-collection',
        locale: 'en',
        contentPath: '/blog/wrong-collection'
      }
    }])
    mocks.getContentProvider.mockResolvedValue({ ...provider, navigation })
    const handler = (await import('../../packages/content/src/runtime/server/api/navigation')).default
    const event = createTestEvent({
      scenario,
      provider,
      query: { collection: 'docs' }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusMessage: 'provider_result_invalid',
      data: expect.objectContaining({
        operation: 'navigation',
        field: 'result[0].route.collection'
      })
    })
  })

  test('navigation API rejects provider route locales outside collection policy', async () => {
    const navigation = vi.fn(async () => [{
      title: 'Unknown locale',
      route: {
        collection: 'docs',
        canonicalKey: 'docs:unknown-locale',
        locale: 'fr',
        contentPath: '/fr/docs/unknown-locale'
      }
    }])
    mocks.getContentProvider.mockResolvedValue({ ...provider, navigation })
    const handler = (await import('../../packages/content/src/runtime/server/api/navigation')).default
    const event = createTestEvent({
      scenario,
      provider,
      query: { collection: 'docs' }
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusMessage: 'provider_result_invalid',
      data: expect.objectContaining({
        operation: 'navigation',
        field: 'result[0].route.locale'
      })
    })
  })

  test('server navigation rejects provider route facts outside the requested collection', async () => {
    const navigationOperation = vi.fn(async () => [{
      title: 'Wrong collection',
      route: {
        collection: 'posts',
        canonicalKey: 'posts:wrong-collection',
        locale: 'en',
        contentPath: '/blog/wrong-collection'
      }
    }])
    mocks.getContentProvider.mockResolvedValue({ ...provider, navigation: navigationOperation })
    const { navigation } = await import('../../packages/content/src/runtime/server/query-api')
    const event = createTestEvent({ scenario, provider })

    await expect(navigation(event, 'docs')).rejects.toMatchObject({
      statusMessage: 'provider_result_invalid',
      data: expect.objectContaining({
        operation: 'navigation',
        field: 'result[0].route.collection'
      })
    })
  })

  test('server query context rejects unconfigured collections before provider operations', async () => {
    const queryOperation = vi.fn(provider.query.bind(provider))
    const navigationOperation = vi.fn(provider.navigation!.bind(provider))
    const surroundingsOperation = vi.fn(provider.surroundings!.bind(provider))
    mocks.getContentProvider.mockResolvedValue({
      ...provider,
      query: queryOperation,
      navigation: navigationOperation,
      surroundings: surroundingsOperation
    })
    const { createServerContentQueryContext } = await import('../../packages/content/src/runtime/server/query-api')
    const event = createTestEvent({ scenario, provider })
    const context = await createServerContentQueryContext(event)

    await expect(context.transport('query', { collection: 'constructor' })).rejects.toMatchObject({
      statusMessage: 'unknown_collection',
      data: { code: 'unknown_collection', field: 'collection' }
    })
    await expect(context.transport('navigation', { collection: 'constructor' })).rejects.toMatchObject({
      statusMessage: 'unknown_collection',
      data: { code: 'unknown_collection', field: 'collection' }
    })
    await expect(context.surroundings!('constructor', '/private', {})).rejects.toMatchObject({
      statusMessage: 'unknown_collection',
      data: { code: 'unknown_collection', field: 'collection' }
    })

    expect(queryOperation).not.toHaveBeenCalled()
    expect(navigationOperation).not.toHaveBeenCalled()
    expect(surroundingsOperation).not.toHaveBeenCalled()
  })

  test('direct server queries reject malformed public options before provider dispatch', async () => {
    const queryOperation = vi.fn(provider.query.bind(provider))
    mocks.getContentProvider.mockResolvedValue({ ...provider, query: queryOperation })
    const { many, one } = await import('../../packages/content/src/runtime/server/query-api')
    const event = createTestEvent({ scenario, provider })

    await expect(one(event, 'docs', { by: {} } as never)).rejects.toThrow(/Invalid content query selector/)
    await expect(many(event, 'docs', { where: { $or: [] } } as never)).rejects.toThrow(/logical groups cannot be empty/)
    await expect(many(event, 'docs', { skip: -1 } as never)).rejects.toThrow(/skip must be a non-negative/)

    expect(queryOperation).not.toHaveBeenCalled()
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

  test('server surround rejects provider route facts outside the requested collection', async () => {
    const surroundings = vi.fn(async () => [{
      title: 'Wrong collection',
      route: {
        collection: 'posts',
        canonicalKey: 'posts:wrong-collection',
        locale: 'de',
        contentPath: '/blog/wrong-collection'
      }
    }, null])
    mocks.getContentProvider.mockResolvedValue({ ...provider, surroundings })
    const { surround } = await import('../../packages/content/src/runtime/server/query-api')
    const event = createTestEvent({ scenario, provider })

    await expect(surround(event, 'docs', {
      by: { route: '/de/dokumentation/erste-schritte' },
      locale: 'de',
      fallback: true
    })).rejects.toMatchObject({
      statusMessage: 'provider_result_invalid',
      data: expect.objectContaining({
        operation: 'surroundings',
        field: 'result[0].route.collection'
      })
    })
  })
})
