import { describe, expect, test } from 'vitest'
import type { ContentProviderCapabilities } from '../../packages/content/src/public/provider'
import { normalizeProviderDocument } from '../../packages/content/src/public/provider-document'
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
import { PROVIDER_CAPABILITY_OPERATORS } from '../../packages/content/src/core/query/operators'

const operators = PROVIDER_CAPABILITY_OPERATORS

const capabilities: ContentProviderCapabilities = {
  query: {
    operators,
    pagination: ['offset', 'cursor']
  }
}

const operatorCases: Record<(typeof operators)[number], { where: Record<string, unknown>, titles: string[] }> = {
  $eq: { where: { title: { $eq: 'Getting Started' } }, titles: ['Getting Started'] },
  $ne: { where: { title: { $ne: 'Getting Started' } }, titles: ['Alltag', 'Einstieg', 'Installation', 'Markdown Syntax', 'Markdown Syntax DE'] },
  $gt: { where: { order: { $gt: 3 } }, titles: ['Markdown Syntax', 'Markdown Syntax DE'] },
  $gte: { where: { order: { $gte: 4 } }, titles: ['Markdown Syntax', 'Markdown Syntax DE'] },
  $lt: { where: { order: { $lt: 2 } }, titles: ['Getting Started', 'Einstieg'] },
  $lte: { where: { order: { $lte: 1 } }, titles: ['Getting Started', 'Einstieg'] },
  $in: { where: { title: { $in: ['Getting Started'] } }, titles: ['Getting Started'] },
  $nin: { where: { title: { $nin: ['Getting Started'] } }, titles: ['Alltag', 'Einstieg', 'Installation', 'Markdown Syntax', 'Markdown Syntax DE'] },
  $contains: { where: { tags: { $contains: 'guide' } }, titles: ['Getting Started'] },
  $containsAny: { where: { tags: { $containsAny: ['guide'] } }, titles: ['Getting Started'] },
  $icontains: { where: { title: { $icontains: 'markdown' } }, titles: ['Markdown Syntax', 'Markdown Syntax DE'] },
  $exists: { where: { featured: { $exists: true } }, titles: ['Getting Started'] },
  $type: { where: { rating: { $type: 'number' } }, titles: ['Getting Started'] },
  $regex: { where: { title: { $regex: '^Getting' } }, titles: ['Getting Started'] },
  $prefix: { where: { path: { $prefix: '/docs/essentials' } }, titles: ['Markdown Syntax'] }
}

const assertTitles = (expected: string[]) => (result: unknown) => {
  const titles = (result as { result: Array<{ title: string }> }).result
    .map(document => document.title)
    .sort()
  expect(titles).toEqual([...expected].sort())
}

const assertOrderedTitles = (expected: string[]) => (result: unknown) => {
  const titles = (result as { result: Array<{ title: string }> }).result
    .map(document => document.title)
  expect(titles).toEqual(expected)
}

const operatorProbes = Object.fromEntries(operators.map(operator => [operator, {
  positive: toContentProviderQuery({
    collection: 'docs',
    where: operatorCases[operator].where
  }),
  assertResult: assertTitles(operatorCases[operator].titles)
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
    logicalProbes: {
      and: {
        positive: toContentProviderQuery({
          collection: 'docs',
          where: { $and: [{ order: { $gte: 1 } }, { order: { $lte: 1 } }] }
        }),
        assertResult: assertTitles(['Getting Started', 'Einstieg'])
      },
      or: {
        positive: toContentProviderQuery({
          collection: 'docs',
          where: { $or: [{ title: { $eq: 'Getting Started' } }, { title: { $eq: 'Installation' } }] }
        }),
        assertResult: assertTitles(['Getting Started', 'Installation'])
      },
      not: {
        positive: toContentProviderQuery({
          collection: 'docs',
          where: { $not: { order: { $gte: 2 } } }
        }),
        assertResult: assertTitles(['Getting Started', 'Einstieg'])
      }
    },
    sortProbe: {
      positive: toContentProviderQuery({
        collection: 'docs',
        where: { locale: 'de' },
        sort: [{ order: -1 }]
      }),
      assertResult: assertOrderedTitles(['Markdown Syntax DE', 'Alltag', 'Installation', 'Einstieg'])
    },
    terminalProbes: {
      first: {
        positive: toContentProviderQuery({
          collection: 'docs',
          where: { locale: 'de' },
          sort: [{ order: -1 }],
          first: true
        }),
        assertResult: result => expect(result).toMatchObject({ result: { title: 'Markdown Syntax DE' } })
      },
      count: {
        positive: toContentProviderQuery({
          collection: 'docs',
          where: { locale: 'de' },
          count: true
        }),
        assertResult: result => expect(result).toEqual({ result: 4 })
      }
    },
    paginationProbes: {
      offset: {
        positive: toContentProviderQuery({
          collection: 'docs',
          paging: { mode: 'offset', skip: 1, limit: 1 }
        }),
        assertResult: (result) => {
          expect((result as { result: unknown[] }).result).toHaveLength(1)
          expect(result).toMatchObject({ skip: 1, limit: 1 })
        }
      },
      cursor: {
        positive: toContentProviderQuery({
          collection: 'docs',
          paging: { mode: 'cursor', after: null, limit: 1 }
        }),
        assertResult: (result) => {
          expect((result as { result: unknown[] }).result).toHaveLength(1)
          expect(result).toMatchObject({ mode: 'cursor', limit: 1 })
        }
      }
    }
  })

  test('keeps drafts out of provider query results', async () => {
    const list = await provider.query(createEvent(), toContentProviderQuery({ collection: 'docs' })) as {
      result: Array<{ draft?: boolean }>
    }
    expect(list.result.some(document => document.draft)).toBe(false)
  })

  test.each([
    { projection: { only: ['description'] } },
    { projection: { without: ['collection', 'canonicalKey', 'locale'] } }
  ])('keeps raw identity until canonical projection %#', async ({ projection }) => {
    const params = { collection: 'docs', limit: 2, ...projection }
    const raw = await provider.query(createEvent(), toContentProviderQuery(params))
    const rawDocuments = (raw as { result: Array<Record<string, unknown>> }).result

    expect(rawDocuments[0]).toEqual(expect.objectContaining({
      collection: 'docs',
      canonicalKey: expect.any(String),
      locale: expect.any(String),
      contentPath: expect.stringMatching(/^\//)
    }))
    expect(() => normalizeProviderQueryResponse(params, raw, provider.name, fixture.runtime)).not.toThrow()

    const normalized = normalizeProviderQueryResponse<Record<string, unknown>>(params, raw, provider.name, fixture.runtime)
    if ('only' in projection) {
      expect(normalized.result[0]).toHaveProperty('description')
      expect(normalized.result[0]).not.toHaveProperty('order')
    } else {
      expect(normalized.result[0]).not.toHaveProperty('collection')
      expect(normalized.result[0]).not.toHaveProperty('canonicalKey')
      expect(normalized.result[0]).not.toHaveProperty('locale')
    }
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

  test('keeps drafts out of provider-owned navigation and search results', async () => {
    const navigation = await provider.navigation!(
      createEvent(),
      toContentProviderQuery({ collection: 'docs' })
    )
    const search = await provider.search!(createEvent(), {
      term: 'draft',
      collections: ['docs']
    })

    expect(navigation.map(item => item.title)).not.toContain('Draft Roadmap')
    expect(search).toEqual([])
  })

  test('keeps data collections out of raw route enumeration', async () => {
    const routes = await provider.routes!(createEvent())
    expect(routes.some(route => route.collection === 'versions')).toBe(false)
    expect(routes.some(route => route.draft)).toBe(true)
  })

  test('preserves the canonical provider response envelope', () => {
    const rawDocument = {
      collection: 'docs',
      locale: 'en',
      contentPath: '/docs/intro',
      body: { type: 'root', children: [] },
      title: 'Intro'
    }
    expect(normalizeProviderQueryResponse({ collection: 'docs', limit: 1 }, {
      result: [rawDocument],
      skip: 0,
      limit: 1,
      total: 1
    })).toEqual({
      result: [expect.objectContaining({
        canonicalKey: 'docs:docs/intro',
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

    expect(normalizeProviderQueryResponse({ collection: 'docs', limit: 1 }, {
      result: [normalizeProviderDocument(rawDocument)],
      skip: 0,
      limit: 1,
      total: 1
    })).toMatchObject({
      result: [{ title: 'Intro', route: { resolvedPath: '/docs/intro' } }]
    })

    expect(() => normalizeProviderQueryResponse({ collection: 'docs' }, [
      { title: 'Intro' }
    ])).toThrow(expect.objectContaining({
      data: expect.objectContaining({ code: 'provider_result_invalid' })
    }))
  })

  test.each([
    {
      name: 'cursor total',
      params: { collection: 'docs' },
      response: { mode: 'cursor', result: [], limit: 1, total: 0, pageInfo: { endCursor: null, hasNext: false } }
    },
    {
      name: 'offset pageInfo',
      params: { collection: 'docs' },
      response: { result: [], skip: 0, limit: 1, total: 0, pageInfo: { endCursor: null, hasNext: false } }
    },
    {
      name: 'cursor without a next cursor',
      params: { collection: 'docs' },
      response: { mode: 'cursor', result: [], limit: 1, pageInfo: { endCursor: null, hasNext: true } }
    },
    {
      name: 'negative count',
      params: { collection: 'docs', count: true },
      response: { result: -1 }
    },
    {
      name: 'offset limit above the requested bound',
      params: { collection: 'docs', limit: 1 },
      response: { result: [], skip: 0, limit: 2, total: 0 }
    },
    {
      name: 'offset limit below the requested page size',
      params: { collection: 'docs', limit: 2 },
      response: { result: [], skip: 0, limit: 1, total: 0 }
    },
    {
      name: 'offset result longer than its limit',
      params: { collection: 'docs', limit: 1 },
      response: { result: [{}, {}], skip: 0, limit: 1, total: 2 }
    },
    {
      name: 'cursor limit above the requested bound',
      params: { collection: 'docs', paging: { mode: 'cursor', after: null, limit: 1 } },
      response: { mode: 'cursor', result: [], limit: 2, pageInfo: { endCursor: null, hasNext: false } }
    },
    {
      name: 'offset skip different from the request',
      params: { collection: 'docs', skip: 1, limit: 1 },
      response: { result: [], skip: 0, limit: 1, total: 0 }
    },
    {
      name: 'null first result',
      params: { collection: 'docs', first: true },
      response: { result: null }
    },
    {
      name: 'offset envelope for a cursor request',
      params: { collection: 'docs', paging: { mode: 'cursor', after: null, limit: 1 } },
      response: { result: [], skip: 0, limit: 1, total: 0 }
    },
    {
      name: 'cursor envelope for an offset request',
      params: { collection: 'docs', paging: { mode: 'offset', skip: 0, limit: 1 } },
      response: { mode: 'cursor', result: [], limit: 1, pageInfo: { endCursor: null, hasNext: false } }
    }
  ])('rejects a non-canonical provider $name envelope', ({ params, response }) => {
    expect(() => normalizeProviderQueryResponse(params, response, 'fixture')).toThrow(expect.objectContaining({
      data: expect.objectContaining({ code: 'provider_result_invalid' })
    }))
  })

  test('rejects sparse provider result arrays with a structured boundary error', () => {
    const sparse = new Array(1)
    for (const [params, response] of [
      [
        { collection: 'docs', limit: 1 },
        { result: sparse, skip: 0, limit: 1, total: 1 }
      ],
      [
        { collection: 'docs', paging: { mode: 'cursor' as const, after: null, limit: 1 } },
        { mode: 'cursor', result: sparse, limit: 1, pageInfo: { endCursor: null, hasNext: false } }
      ]
    ] as const) {
      expect(() => normalizeProviderQueryResponse(params, response, 'fixture')).toThrow(expect.objectContaining({
        statusMessage: 'provider_result_invalid'
      }))
    }
  })

  test('normalizes structured provider data documents through the query boundary', () => {
    const result = normalizeProviderQueryResponse({ collection: 'catalog', limit: 1 }, {
      result: [{
        collection: 'catalog',
        locale: 'en',
        contentPath: '/catalog/products',
        type: 'csv',
        body: [{ slug: 'alpha' }]
      }],
      skip: 0,
      limit: 1,
      total: 1
    })

    expect(result.result[0]).toMatchObject({
      type: 'csv',
      body: [{ slug: 'alpha' }]
    })
  })

  test('rejects duplicate provider document ids, canonical variants, and path ownership', () => {
    const base = {
      collection: 'docs',
      locale: 'en',
      canonicalKey: 'docs:intro',
      contentPath: '/docs/intro',
      body: { type: 'root', children: [] }
    }
    const assertInvalid = (documents: unknown[]) => {
      expect(() => normalizeProviderQueryResponse({ collection: 'docs', limit: 2 }, {
        result: documents,
        skip: 0,
        limit: 2,
        total: 2
      }, 'fixture')).toThrow(expect.objectContaining({
        statusMessage: 'provider_result_invalid'
      }))
    }

    assertInvalid([
      { ...base, id: 'shared-id' },
      { ...base, id: 'shared-id', canonicalKey: 'docs:other', contentPath: '/docs/other' }
    ])
    assertInvalid([
      { ...base, id: 'intro-a' },
      { ...base, id: 'intro-b', contentPath: '/docs/introduction' }
    ])
    assertInvalid([
      { ...base, id: 'intro-a' },
      { ...base, id: 'intro-b', canonicalKey: 'docs:other' }
    ])
  })

  test('normalizes the fixture default locale', () => {
    const custom = createProviderFixture({
      defaultLocale: 'en',
      locales: ['de'],
      collections: { docs: { type: 'page' } },
      documents: []
    })
    expect(custom.locales).toEqual(['en', 'de'])
  })
})
