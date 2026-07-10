import { describe, expect, test } from 'vitest'
import {
  isContentProviderResult,
  withContentCache,
  type ContentProvider,
  type ContentProviderCapabilities
} from '../../packages/content/src/public/provider'
import {
  expectProviderCapabilities,
  unwrapProviderContractResult
} from '../../packages/content/src/testing/provider-contract'
import {
  normalizeProviderRouteFact,
  normalizeProviderRoutes
} from '../../packages/content/src/runtime/server/provider-route-facts'

const capabilities: ContentProviderCapabilities = {
  query: {
    operators: ['$eq', '$in'],
    pagination: ['offset']
  }
}

describe('provider contract assertion helpers', () => {
  test('wraps cache metadata behind an opaque public predicate', () => {
    const data = { ok: true }
    const wrapped = withContentCache(data, { tags: ['collection:docs'] })

    expect(isContentProviderResult(wrapped)).toBe(true)
    expect(unwrapProviderContractResult(wrapped)).toBe(data)
    expect(unwrapProviderContractResult(data)).toBe(data)
  })

  test('asserts the exact semantic capability object', () => {
    const provider = {
      name: 'fixture',
      capabilities,
      query: async () => ({ result: [], skip: 0, limit: 0, total: 0 })
    } as ContentProvider

    expectProviderCapabilities(provider, capabilities)
    expect(() => expectProviderCapabilities({
      ...provider,
      capabilities: { ...capabilities, navigation: true }
    } as unknown as ContentProvider, capabilities)).toThrow()
  })

  test('accepts raw route facts and rejects provider-projected URLs', () => {
    expect(normalizeProviderRouteFact({
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro/'
    }, 'fixture', 'navigation')).toEqual({
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro'
    })

    expect(() => normalizeProviderRouteFact({
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro',
      path: '/docs/intro'
    }, 'fixture', 'navigation')).toThrow(/preprojected route field/)
  })

  test('validates route metadata and normalized UTC dates', () => {
    expect(normalizeProviderRoutes([{
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro',
      sitemap: { lastmod: '2026-01-01T00:00:00.000Z' }
    }], 'fixture')).toHaveLength(1)

    expect(() => normalizeProviderRoutes([{
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro',
      sitemap: { lastmod: '2026-01-01' }
    }], 'fixture')).toThrow(/normalized UTC ISO/)
  })
})
