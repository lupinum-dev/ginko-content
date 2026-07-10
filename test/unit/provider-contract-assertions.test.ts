import { describe, expect, test } from 'vitest'
import {
  contentProviderResultMarker,
  createContentProviderError,
  shapeProviderDocument,
  type ContentProvider,
  type ContentProviderCapabilities
} from '../../packages/content/src/public/provider'
import {
  expectNoLegacyProviderEnvelopeFields,
  expectProviderCapabilities,
  expectProviderDocumentEnvelope,
  expectUnsupportedProviderOperation,
  expectUnsupportedProviderQueryShape,
  LEGACY_PROVIDER_ENVELOPE_FIELDS,
  unwrapProviderContractResult
} from '../../packages/content/src/testing/provider-contract'

const capabilities: ContentProviderCapabilities = {
  routeBackedCollections: true,
  dataCollections: true,
  localizedRoutes: true,
  translatedSlugs: true,
  navigation: true,
  surroundings: true,
  searchSections: true,
  sitemap: true,
  query: {
    operators: ['$eq', '$in'],
    pagination: []
  }
}

describe('provider contract assertion helpers', () => {
  test('unwraps marked provider results and leaves raw values alone', () => {
    const data = { ok: true }
    const wrapped = {
      [contentProviderResultMarker]: true,
      data,
      cache: { tags: ['collection:docs'] }
    }

    expect(unwrapProviderContractResult(wrapped)).toBe(data)
    expect(unwrapProviderContractResult(data)).toBe(data)
  })

  test('detects legacy provider envelope fields inside nested results', () => {
    expect(LEGACY_PROVIDER_ENVELOPE_FIELDS).toContain('_id')
    expectNoLegacyProviderEnvelopeFields({ result: [{ id: 'modern' }] })

    const cyclic: Record<string, unknown> = { id: 'modern' }
    cyclic.self = cyclic
    expectNoLegacyProviderEnvelopeFields(cyclic)

    expect(() => expectNoLegacyProviderEnvelopeFields({
      result: [{ _id: 'legacy', title: 'Legacy' }]
    })).toThrow()
  })

  test('asserts the shaped provider document envelope without requiring file provenance', () => {
    const page = shapeProviderDocument({
      collection: 'docs',
      locale: 'en',
      path: '/docs/intro',
      body: { type: 'root', children: [] },
      title: 'Intro'
    }, {
      defaultLocale: 'en',
      locales: ['en']
    })

    expectProviderDocumentEnvelope(page, { locale: 'en', defaultLocale: 'en' })
    expect(page.file).toBeUndefined()
    expect(page.extension).toBeUndefined()
  })

  test('asserts typed unsupported operation and query-shape errors', async () => {
    await expectUnsupportedProviderOperation(() => {
      throw createContentProviderError('unsupported_provider_operation', 'Navigation is disabled.', {
        operation: 'navigation'
      })
    }, 'navigation')

    await expectUnsupportedProviderQueryShape(() => {
      throw createContentProviderError('unsupported_query_shape', 'Count is disabled.', {
        field: 'count'
      })
    }, 'count')
  })

  test('asserts declared provider capabilities and operator subsets', () => {
    const provider = {
      name: 'fixture',
      capabilities: {
        ...capabilities,
        query: {
          ...capabilities.query,
          operators: ['$eq', '$ne', '$in']
        }
      },
      query: async () => ({ result: [], skip: 0, limit: 0, total: 0 })
    } as ContentProvider

    expectProviderCapabilities(provider, capabilities)
  })
})
