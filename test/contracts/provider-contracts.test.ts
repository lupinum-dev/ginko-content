import { describe, expect, test, vi } from 'vitest'
import type { ContentProvider } from '../../packages/content/src/public/provider'
import { toContentProviderQuery } from '../../packages/content/src/public/provider-query'
import {
  enforceProviderCapabilities,
  validateContentProvider
} from '../../packages/content/src/runtime/server/providers'
import {
  normalizeProviderRoutes,
  projectProviderNavigation,
  projectProviderSearchResults,
  projectProviderSurroundings
} from '../../packages/content/src/runtime/server/provider-route-facts'
import { createEvent } from './_utils'

const createProvider = (overrides: Partial<ContentProvider> = {}): ContentProvider => ({
  name: 'remote' as ContentProvider['name'],
  capabilities: {
    query: {
      operators: ['$eq'],
      pagination: []
    }
  },
  query: vi.fn(async () => ({ result: [], skip: 0, limit: 100, total: 0 })),
  ...overrides
})

describe('provider registry contract', () => {
  test('accepts only semantic query capabilities', () => {
    expect(validateContentProvider('remote', createProvider())).toBeTruthy()

    for (const name of ['', 'different']) {
      expect(() => validateContentProvider('remote', createProvider({ name }))).toThrow(expect.objectContaining({
        statusMessage: 'provider_module_invalid',
        data: expect.objectContaining({ provider: 'remote', field: 'name' })
      }))
    }

    expect(() => validateContentProvider('remote', {
      ...createProvider(),
      capabilities: {
        query: { operators: ['$eq'], pagination: [] },
        navigation: true
      }
    })).toThrow(expect.objectContaining({
      statusMessage: 'provider_module_invalid',
      data: expect.objectContaining({ field: 'capabilities' })
    }))

    for (const query of [
      { operators: ['$madeUp'], pagination: [] },
      { operators: ['$and'], pagination: [] },
      { operators: ['$options'], pagination: [] },
      { operators: ['$eq', '$eq'], pagination: [] }
    ]) {
      expect(() => validateContentProvider('remote', {
        ...createProvider(),
        capabilities: { query }
      })).toThrow(expect.objectContaining({
        statusMessage: 'provider_module_invalid',
        data: expect.objectContaining({ field: 'capabilities.query.operators' })
      }))
    }

    expect(() => validateContentProvider('remote', {
      ...createProvider(),
      capabilities: { query: { operators: ['$eq'], pagination: ['offset', 'offset'] } }
    })).toThrow(expect.objectContaining({
      statusMessage: 'provider_module_invalid',
      data: expect.objectContaining({ field: 'capabilities.query.pagination' })
    }))
  })

  test('infers optional operation support from method presence and validates methods', () => {
    const navigation = vi.fn(async () => [])
    const provider = validateContentProvider('remote', createProvider({ navigation }))
    expect(provider.navigation).toBe(navigation)

    expect(() => validateContentProvider('remote', {
      ...createProvider(),
      routes: true
    })).toThrow(expect.objectContaining({
      data: expect.objectContaining({ field: 'routes' })
    }))
  })

  test('rejects unsupported operators before provider dispatch', async () => {
    const query = vi.fn(async () => ({ result: [], skip: 0, limit: 100, total: 0 }))
    const provider = enforceProviderCapabilities(createProvider({ query }))

    await expect(provider.query(createEvent(), toContentProviderQuery({
      collection: 'docs',
      where: { title: { $contains: 'intro' } }
    }))).rejects.toMatchObject({
      statusMessage: 'unsupported_query_operator',
      data: expect.objectContaining({ operator: '$contains' })
    })
    expect(query).not.toHaveBeenCalled()
  })

  test('treats logical plan nodes as wire structure rather than capabilities', async () => {
    const query = vi.fn(async () => ({ result: [], skip: 0, limit: 100, total: 0 }))
    const provider = enforceProviderCapabilities(createProvider({ query }))

    await provider.query(createEvent(), toContentProviderQuery({
      collection: 'docs',
      where: {
        $or: [
          { title: 'Intro' },
          { title: 'Guide' }
        ]
      }
    }))

    await provider.query(createEvent(), toContentProviderQuery({
      collection: 'docs',
      where: { $not: { title: { $eq: 'Draft' } } }
    }))

    expect(query).toHaveBeenCalledTimes(2)
  })

  test('rejects unsupported pagination and versions before provider dispatch', async () => {
    const query = vi.fn(async () => ({ result: [], skip: 0, limit: 100, total: 0 }))
    const provider = enforceProviderCapabilities(createProvider({ query }))

    await expect(provider.query(createEvent(), toContentProviderQuery({
      collection: 'docs',
      skip: 1
    }))).rejects.toMatchObject({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({ field: 'skip' })
    })

    await expect(provider.query(createEvent(), {
      ...toContentProviderQuery({ collection: 'docs' }),
      v: 1 as 2
    })).rejects.toMatchObject({
      statusMessage: 'unsupported_query_shape',
      data: expect.objectContaining({ field: 'v' })
    })
    expect(query).not.toHaveBeenCalled()
  })

  test('dispatches the closed query unchanged without leaking core visibility policy', async () => {
    const query = vi.fn(async () => ({ result: [], skip: 0, limit: 100, total: 0 }))
    const navigation = vi.fn(async () => [])
    const provider = enforceProviderCapabilities(createProvider({ query, navigation }))
    const lowered = toContentProviderQuery({ collection: 'docs' })

    await provider.query(createEvent(), lowered)
    await provider.navigation!(createEvent(), lowered)

    expect(query).toHaveBeenCalledWith(expect.anything(), lowered)
    expect(navigation).toHaveBeenCalledWith(expect.anything(), lowered, undefined)
  })
})

describe('raw provider route facts', () => {
  const runtime = {
    defaultLocale: 'en',
    locales: ['en', 'de'],
    localeFallback: { de: ['en'] },
    collections: {
      docs: {
        type: 'page' as const,
        i18n: { locales: ['en', 'de'], defaultLocale: 'en' },
        localePolicy: {
          localized: true,
          locales: ['en', 'de'],
          defaultLocale: 'en',
          fallback: { de: ['en'] },
          translatedSlugs: false,
          routeMounts: { en: '/docs', de: '/dokumentation' }
        }
      }
    }
  }
  const route = {
    collection: 'docs',
    canonicalKey: 'docs:intro',
    locale: 'de',
    contentPath: '/einstieg'
  }

  test('core projects navigation, surroundings, and search URLs', () => {
    expect(projectProviderNavigation([{ title: 'Einstieg', route }], 'remote', runtime)).toEqual([
      { title: 'Einstieg', path: '/de/dokumentation/einstieg' }
    ])
    expect(projectProviderSurroundings([{ title: 'Einstieg', route }, null], 'remote', runtime)).toEqual([
      { title: 'Einstieg', path: '/de/dokumentation/einstieg' },
      null
    ])
    expect(projectProviderSearchResults([{
      title: 'Einstieg',
      excerpt: 'Start',
      score: 1,
      route
    }], 'remote', runtime)).toEqual([expect.objectContaining({
      collection: 'docs',
      locale: 'de',
      path: '/de/dokumentation/einstieg'
    })])
  })

  test('does not localize provider navigation when a collection explicitly disables global i18n', () => {
    const unlocalizedRuntime = {
      ...runtime,
      collections: {
        docs: {
          type: 'page' as const,
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

    expect(projectProviderNavigation([{
      title: 'Intro',
      route: {
        collection: 'docs',
        canonicalKey: 'docs:intro',
        locale: 'de',
        contentPath: '/docs/intro'
      }
    }], 'remote', unlocalizedRuntime, 'de')).toEqual([{
      title: 'Intro',
      path: '/docs/intro'
    }])
  })

  test('rejects preprojected URLs on every raw route surface', () => {
    expect(() => projectProviderNavigation([{
      title: 'Einstieg',
      path: '/de/dokumentation/einstieg',
      route
    }], 'remote', runtime)).toThrow(/preprojected route field/)
  })

  test('rejects malformed provider search results at the provider boundary', () => {
    for (const result of [
      null,
      {},
      [{ title: 'Einstieg', score: Number.NaN, route }],
      [{ title: 42, score: 1, route }],
      [{ title: 'Einstieg', excerpt: 42, score: 1, route }]
    ]) {
      expect(() => projectProviderSearchResults(result, 'remote', runtime)).toThrow(expect.objectContaining({
        statusMessage: 'provider_result_invalid'
      }))
    }
  })

  test('validates route candidates without applying consumer policy', () => {
    expect(normalizeProviderRoutes([{ ...route, draft: true, sitemap: false }], 'remote')).toEqual([
      { ...route, draft: true, sitemap: false }
    ])
  })
})
