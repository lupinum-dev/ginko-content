import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ContentProvider } from '../../packages/content/src/public/provider'
import { createInMemoryProvider } from '../harness/provider'
import { createSaasI18nScenario } from '../harness/scenarios'
import { createTestEvent } from '../harness/event'
import { expectProviderError } from '../harness/assertions'

const mocks = vi.hoisted(() => ({
  getContentProvider: vi.fn()
}))

const runtime = vi.hoisted(() => ({
  public: {
    content: {
      siteUrl: 'https://example.test',
      sitemap: {
        include: ['docs']
      }
    }
  },
  content: {
    search: {
      engine: 'provider',
      collections: ['docs']
    },
    defaultLocale: 'en',
    locales: ['en', 'de'],
    localeFallback: { de: ['en'] },
    collections: {
      docs: {
        i18n: { defaultLocale: 'en', locales: ['en', 'de'] }
      },
      posts: {
        i18n: { defaultLocale: 'en', locales: ['en', 'de'] }
      },
      authors: {
        i18n: { defaultLocale: 'en', locales: ['en', 'de'] }
      },
      versions: {
        i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
        sitemap: false
      }
    }
  }
}))

vi.stubGlobal('__ginkoTestRuntimeConfig', runtime)

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: mocks.getContentProvider
}))

vi.mock('../../packages/content/src/runtime/server/search', () => ({
  buildSearchIndex: vi.fn(async () => [])
}))

describe('runtime auxiliary API provider boundaries', () => {
  const scenario = createSaasI18nScenario()
  const provider = createInMemoryProvider(scenario)

  beforeEach(() => {
    mocks.getContentProvider.mockReset()
    mocks.getContentProvider.mockResolvedValue(provider)
    runtime.content.collections = scenario.runtime.collections as never
    runtime.content.search = {
      engine: 'provider',
      collections: ['docs']
    }
    runtime.public.content.sitemap = {
      include: ['docs']
    }
  })

  test('locales API resolves identity variants through exact provider queries', async () => {
    const query = vi.fn(provider.query.bind(provider))
    mocks.getContentProvider.mockResolvedValue({ ...provider, query })
    const handler = (await import('../../packages/content/src/runtime/server/api/locales')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: { collection: 'docs' },
      query: { identity: 'docs:getting-started' }
    })

    await expect(handler(event)).resolves.toEqual([
      { canonicalKey: 'docs:getting-started', locale: 'de', path: '/de/dokumentation/erste-schritte' },
      { canonicalKey: 'docs:getting-started', locale: 'en', path: '/docs/getting-started' }
    ])
    expect(query).toHaveBeenCalled()
    for (const [, dispatched] of query.mock.calls) {
      expect(JSON.stringify(dispatched.plan.filter)).toContain('canonicalKey')
      expect(JSON.stringify(dispatched.plan.filter)).toContain('docs:getting-started')
    }
  })

  test('locales API rejects non-own collection names before external-provider lookup or dispatch', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/locales')).default
    const event = createTestEvent({
      scenario,
      provider,
      params: { collection: 'constructor' },
      query: { identity: 'private:document' }
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
    expect(JSON.stringify(thrown)).not.toContain('private:document')
    expect(mocks.getContentProvider).not.toHaveBeenCalled()
  })

  test('sitemap API forwards query/runtime include options to the provider', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/sitemap')).default
    const event = createTestEvent({
      scenario,
      provider,
      query: {
        include: 'docs'
      }
    })

    await expect(handler(event)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ loc: '/docs/getting-started', _sitemap: 'en' }),
        expect.objectContaining({
          loc: '/de/dokumentation/erste-schritte',
          _sitemap: 'de'
        })
      ])
    )
  })

  test('search API delegates provider-backed search and preserves provider errors', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/search')).default
    const event = createTestEvent({
      scenario,
      provider,
      query: {
        q: 'fallback',
        locale: 'en'
      }
    })

    await expect(handler(event)).resolves.toEqual([
      expect.objectContaining({
        title: 'Fallback Lab',
        path: '/docs/essentials/fallback-lab',
        locale: 'en'
      })
    ])

    const providerWithoutSearch = {
      ...provider,
      search: undefined
    } as ContentProvider
    mocks.getContentProvider.mockResolvedValueOnce(providerWithoutSearch)
    await expectProviderError(handler(event), 'unsupported_provider_search', { provider: 'in-memory' })
  })

  test('site-data API validates request keys and delegates supported providers', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/site-data')).default
    const event = createTestEvent({
      scenario,
      provider,
      query: {
        key: 'navigation.footer',
        locale: 'de'
      }
    })

    await expect(handler(event)).resolves.toMatchObject({
      key: 'navigation.footer',
      locale: 'de',
      data: null
    })

    await expect(handler(createTestEvent({ scenario, provider }))).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'missing_site_data_key'
    })
  })

  test('site-data API rejects provider identity echoes, missing data, and invalid timestamps', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/site-data')).default
    const event = createTestEvent({
      scenario,
      provider,
      query: { key: 'navigation.footer', locale: 'en' }
    })

    for (const response of [
      { key: 'navigation.header', locale: 'en', data: null },
      { key: 'navigation.footer', locale: 'de', data: null },
      { key: 'navigation.footer', locale: 'en', data: null, updatedAt: -1 },
      { key: 'navigation.footer', locale: null, data: null },
      { key: 'navigation.footer', locale: 'en', data: null, updatedAt: null },
      {}
    ]) {
      mocks.getContentProvider.mockResolvedValueOnce({
        ...provider,
        siteData: vi.fn(async () => response)
      })
      await expect(handler(event)).rejects.toMatchObject({
        statusMessage: 'provider_result_invalid',
        data: expect.objectContaining({ operation: 'siteData' })
      })
    }
  })

  test('site-data API rejects non-JSON provider data', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/site-data')).default
    const event = createTestEvent({ scenario, provider, query: { key: 'announcement' } })

    for (const data of [
      { publishedAt: new Date('2026-01-01T00:00:00.000Z') }
    ]) {
      mocks.getContentProvider.mockResolvedValueOnce({
        ...provider,
        siteData: vi.fn(async () => ({ data }))
      })
      await expect(handler(event)).rejects.toMatchObject({
        statusMessage: 'provider_result_invalid',
        data: expect.objectContaining({ operation: 'siteData', field: 'result.data' })
      })
    }
  })
})
