import { beforeEach, describe, expect, test, vi } from 'vitest'
import { isError as isH3Error } from 'h3'
import { createContentProviderError } from '../../packages/content/src/public/provider-errors'
import { createContentProviderError as createCoreProviderError } from '../../packages/content/src/core/provider-errors'
import {
  assertConfiguredProviderCollection,
  createProviderQuery,
  normalizeProviderQueryResponse
} from '../../packages/content/src/runtime/server/provider-query'
import { getContentProvider } from '../../packages/content/src/runtime/server/providers'

const providerRegistry = vi.hoisted(() => ({
  load: vi.fn()
}))

vi.mock('#content/virtual/providers', () => ({
  externalContentProviderNames: [],
  loadExternalContentProvider: providerRegistry.load
}))

const expectPrivateCause = (error: Error & { cause?: unknown }, cause: unknown) => {
  expect(error.cause).toBe(cause)
  expect(Object.prototype.propertyIsEnumerable.call(error, 'cause')).toBe(false)
  expect(Object.keys(error)).not.toContain('cause')
}

describe('public provider errors', () => {
  beforeEach(() => {
    providerRegistry.load.mockReset()
    vi.stubGlobal('__ginkoTestRuntimeConfig', {})
  })

  test('keeps an internal cause available without making it public data', () => {
    const cause = new Error('postgres://user:secret@internal.example/content')
    const error = createContentProviderError(
      'provider_result_invalid',
      'Content provider returned an invalid result.',
      { provider: 'remote', operation: 'query' },
      cause
    )

    expect(error.data).toEqual({
      code: 'provider_result_invalid',
      provider: 'remote',
      operation: 'query'
    })
    expect(isH3Error(error)).toBe(true)
    expectPrivateCause(error, cause)
    expect(JSON.stringify(error)).not.toContain('postgres://')
    expect(JSON.stringify(error)).not.toContain('secret')
  })

  test('keeps core errors runtime-neutral and classifies unknown providers as server failures', () => {
    const error = createCoreProviderError('unknown_provider', 'Unknown content provider.', { provider: 'missing' })

    expect(isH3Error(error)).toBe(false)
    expect(error).toMatchObject({
      statusCode: 500,
      statusMessage: 'unknown_provider',
      data: { code: 'unknown_provider', provider: 'missing' }
    })
  })

  test('does not expose an external provider module load failure', async () => {
    const cause = new Error('Cannot import /srv/private/providers/acme.mjs?token=secret')
    providerRegistry.load.mockRejectedValueOnce(cause)
    vi.stubGlobal('__ginkoTestRuntimeConfig', { content: { provider: 'acme' } })

    let thrown: unknown
    try {
      await getContentProvider()
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      statusMessage: 'provider_module_missing',
      message: 'Content provider module for acme could not be loaded.',
      data: {
        code: 'provider_module_missing',
        provider: 'acme'
      }
    })
    expectPrivateCause(thrown as Error & { cause?: unknown }, cause)
    expect(JSON.stringify(thrown)).not.toContain('/srv/private')
    expect(JSON.stringify(thrown)).not.toContain('secret')
  })

  test('keeps provider document validation details on the private cause', () => {
    let thrown: unknown
    try {
      normalizeProviderQueryResponse({ collection: 'docs', limit: 1 }, {
        result: [{
          collection: 'docs',
          canonicalKey: 'docs:intro',
          locale: 'en',
          contentPath: '/docs/intro',
          body: { type: 'root', children: [] },
          file: { path: '/srv/private/content/secret.md' },
          internalValue: 1n
        }],
        skip: 0,
        limit: 1,
        total: 1
      }, 'remote')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toMatchObject({
      statusMessage: 'provider_result_invalid',
      message: 'remote returned an invalid ProviderDocumentInput.',
      data: {
        code: 'provider_result_invalid',
        provider: 'remote',
        collection: 'docs',
        operation: 'query',
        field: 'result'
      }
    })
    expect((thrown as Error & { cause?: Error }).cause?.message).toContain('/srv/private/content/secret.md')
    expectPrivateCause(thrown as Error & { cause?: unknown }, (thrown as Error & { cause?: unknown }).cause)
    expect(JSON.stringify(thrown)).not.toContain('/srv/private')
    expect(JSON.stringify(thrown)).not.toContain('internalValue')
  })

  test('reports provider paths outside their configured mount as structured provider errors', () => {
    const runtime = {
      defaultLocale: 'en',
      collections: {
        docs: {
          localePolicy: {
            localized: true,
            locales: ['en', 'de'],
            defaultLocale: 'en',
            fallback: {},
            translatedSlugs: false,
            routeMounts: { en: '/docs', de: '/dokumentation' }
          }
        }
      }
    }

    expect(() => normalizeProviderQueryResponse({ collection: 'docs', limit: 1 }, {
      result: [{
        collection: 'docs',
        canonicalKey: 'docs:intro',
        locale: 'de',
        contentPath: '/docs/intro',
        routeVariants: [
          { locale: 'en', contentPath: '/docs/intro' },
          { locale: 'de', contentPath: '/docs/intro' }
        ],
        body: { type: 'root', children: [] }
      }],
      skip: 0,
      limit: 1,
      total: 1
    }, 'remote', runtime)).toThrow(expect.objectContaining({
      statusMessage: 'provider_result_invalid',
      message: 'remote returned an invalid ProviderDocumentInput.',
      data: expect.objectContaining({
        code: 'provider_result_invalid',
        field: 'result'
      })
    }))
  })

  test('does not echo an out-of-scope collection returned by a provider', () => {
    expect(() => normalizeProviderQueryResponse({ collection: 'docs', limit: 1 }, {
      result: [{
        collection: 'private-tenant-secret',
        canonicalKey: 'private:intro',
        locale: 'en',
        contentPath: '/private',
        body: { type: 'root', children: [] }
      }],
      skip: 0,
      limit: 1,
      total: 1
    }, 'remote')).toThrow(expect.objectContaining({
      message: 'remote returned a document outside the requested collection.',
      data: {
        code: 'provider_result_invalid',
        provider: 'remote',
        collection: 'docs',
        operation: 'query',
        field: 'result.collection'
      }
    }))
  })

  test('uses only own content.config collection keys as the provider allowlist', () => {
    const collections = Object.assign(Object.create({ inherited: {} }), { docs: {} })
    const runtime = { collections }

    expect(() => assertConfiguredProviderCollection('docs', runtime)).not.toThrow()
    for (const collection of ['inherited', 'constructor', 'missing']) {
      expect(() => assertConfiguredProviderCollection(collection, runtime)).toThrow(expect.objectContaining({
        statusMessage: 'unknown_collection',
        message: 'Content collection is not configured.',
        data: {
          code: 'unknown_collection',
          field: 'collection'
        }
      }))
    }
  })

  test('rejects duplicate pagination authorities before provider dispatch', () => {
    expect(() => createProviderQuery({
      collection: 'docs',
      skip: 0,
      paging: { mode: 'offset', skip: 0, limit: 10 }
    })).toThrow(expect.objectContaining({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({ code: 'unsupported_query_shape', field: 'skip' })
    }))

    expect(() => createProviderQuery({
      collection: 'docs',
      limit: 10,
      paging: { mode: 'cursor', after: null, limit: 10 }
    })).toThrow(expect.objectContaining({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({ code: 'unsupported_query_shape', field: 'limit' })
    }))
  })

  test('reports a route-mount failure as a query-shape error rather than a bare projection error', () => {
    const runtimeConfig = {
      collections: {
        docs: {
          localePolicy: {
            localized: true,
            locales: ['en', 'de'],
            defaultLocale: 'en',
            fallback: {},
            translatedSlugs: false,
            // `de` has no mount: mounting a `de` variant selector must fail
            // through the provider error channel, not as a RouteProjectionError.
            routeMounts: { en: '/guide' }
          }
        }
      }
    }

    expect(() => createProviderQuery({
      collection: 'docs',
      first: true,
      resolveVariant: { path: '/intro', locale: 'de' }
    }, runtimeConfig as never)).toThrow(expect.objectContaining({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({ collection: 'docs', field: 'resolveVariant' })
    }))
  })
})
