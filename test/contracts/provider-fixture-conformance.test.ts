import { describe, expect, test } from 'vitest'
import type { ContentProviderCapabilities } from '../../packages/content/src/public/provider'
import { toContentProviderQuery } from '../../packages/content/src/public/provider-query'
import { normalizeProviderQueryResponse } from '../../packages/content/src/runtime/server/provider-query'
import {
  createDefaultProviderFixture,
  createFixtureContentProvider,
  createProviderFixture,
  createProviderFixtureEvent
} from '../../packages/content/src/testing/provider-fixture'
import {
  runProviderContractSuite,
  type ProviderQueryProbe
} from '../../packages/content/src/testing/provider-contract'

const operators = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
  '$contains', '$containsAny', '$icontains', '$exists', '$type',
  '$regex', '$prefix', '$not', '$and', '$or'
] as const

const capabilities: ContentProviderCapabilities = {
  query: {
    operators,
    pagination: ['offset', 'cursor']
  }
}

const whereByOperator: Record<(typeof operators)[number], Record<string, unknown>> = {
  $eq: { title: { $eq: 'Getting Started' } },
  $ne: { title: { $ne: 'never' } },
  $gt: { order: { $gt: 0 } },
  $gte: { order: { $gte: 1 } },
  $lt: { order: { $lt: 10 } },
  $lte: { order: { $lte: 10 } },
  $in: { title: { $in: ['Getting Started'] } },
  $nin: { title: { $nin: ['never'] } },
  $contains: { authors: { $contains: 'authors.emily' } },
  $containsAny: { authors: { $containsAny: ['authors.emily'] } },
  $icontains: { title: { $icontains: 'start' } },
  $exists: { title: { $exists: true } },
  $type: { title: { $type: 'string' } },
  $regex: { title: { $regex: 'Started' } },
  $prefix: { path: { $prefix: '/docs' } },
  $not: { $not: { title: { $eq: 'never' } } },
  $and: { $and: [{ title: { $exists: true } }, { order: { $gte: 1 } }] },
  $or: { $or: [{ title: { $eq: 'Getting Started' } }, { title: { $eq: 'Einstieg' } }] }
}

const operatorProbes = Object.fromEntries(operators.map(operator => [operator, {
  positive: toContentProviderQuery({
    collection: 'docs',
    where: whereByOperator[operator]
  })
}])) as Record<string, ProviderQueryProbe>

describe('provider fixture conformance', () => {
  const fixture = createDefaultProviderFixture()
  const provider = createFixtureContentProvider(fixture)
  const createEvent = () => createProviderFixtureEvent({ fixture, provider })

  runProviderContractSuite({
    name: 'provider fixture',
    expectedProviderName: 'fixture',
    loadProvider: async () => provider,
    createEvent,
    expectedCapabilities: capabilities,
    operatorProbes,
    paginationProbes: {
      offset: {
        positive: toContentProviderQuery({ collection: 'docs', skip: 1, limit: 1 })
      },
      cursor: {
        positive: toContentProviderQuery({
          collection: 'docs',
          paging: { mode: 'cursor', after: null, limit: 1 }
        })
      }
    }
  })

  test('returns drafts as raw facts for core to filter', async () => {
    const list = await provider.query(createEvent(), toContentProviderQuery({ collection: 'docs' })) as {
      result: Array<{ draft?: boolean }>
    }
    expect(list.result.some(document => document.draft)).toBe(true)
  })

  test('returns raw facts from every optional route-bearing operation', async () => {
    const query = toContentProviderQuery({ collection: 'docs', only: ['description'] })
    const navigation = await provider.navigation!(createEvent(), query, { locale: 'de' })
    const surroundings = await provider.surroundings!(
      createEvent(),
      'docs',
      '/dokumentation/einstieg/installation',
      { locale: 'de' }
    )
    const search = await provider.search!(createEvent(), {
      term: 'Markdown',
      locale: 'de',
      collections: ['docs']
    })

    const rawFacts = {
      navigation: navigation.find(item => item.route)?.route,
      surroundings: surroundings.find(item => item?.route)?.route,
      search: search[0]?.route
    }
    for (const [operation, value] of Object.entries(rawFacts)) {
      expect(value, `${operation} must return a raw route fact`).toBeDefined()
      expect(value).toEqual(expect.objectContaining({
        collection: 'docs',
        canonicalKey: expect.any(String),
        locale: expect.any(String),
        contentPath: expect.stringMatching(/^\//)
      }))
      expect(value).not.toHaveProperty('path')
    }
  })

  test('keeps data collections out of raw route enumeration', async () => {
    const routes = await provider.routes!(createEvent())
    expect(routes.some(route => route.collection === 'versions')).toBe(false)
    expect(routes.some(route => route.draft)).toBe(true)
  })

  test('preserves the canonical provider response envelope', () => {
    const rawDocument = {
      collection: 'docs',
      canonicalKey: 'docs:intro',
      locale: 'en',
      contentPath: '/docs/intro',
      body: { type: 'root', children: [] },
      title: 'Intro'
    }
    expect(normalizeProviderQueryResponse({ collection: 'docs' }, {
      result: [rawDocument],
      skip: 0,
      limit: 1,
      total: 1
    })).toEqual({
      result: [expect.objectContaining({
        title: 'Intro',
        route: expect.objectContaining({ resolvedPath: '/docs/intro' }),
        resolution: expect.objectContaining({
          resolved: { locale: 'en' },
          usedFallback: false
        })
      })],
      skip: 0,
      limit: 1,
      total: 1
    })

    expect(() => normalizeProviderQueryResponse({ collection: 'docs' }, [
      { title: 'Intro' }
    ])).toThrow(expect.objectContaining({
      data: expect.objectContaining({ code: 'provider_result_invalid' })
    }))
  })

  test('normalizes fixture defaults and invalidates recorded cache dependencies', async () => {
    const custom = createProviderFixture({
      defaultLocale: 'en',
      locales: ['de'],
      collections: { docs: { type: 'page' } },
      documents: []
    })
    expect(custom.locales).toEqual(['en', 'de'])

    provider.cache.dependenciesByPath.set('/docs/intro', new Set(['collection:docs']))
    provider.cache.pathsByTag.set('collection:docs', new Set(['/docs/intro']))
    provider.cache.renderedPaths.add('/docs/intro')
    await provider.invalidate!(createEvent(), { tags: ['collection:docs'] })
    expect(provider.cache.renderedPaths.has('/docs/intro')).toBe(false)
  })
})
