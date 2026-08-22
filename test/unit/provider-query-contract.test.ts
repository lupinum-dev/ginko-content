import { describe, expect, test, vi } from 'vitest'

import { collectPlanFilterOperators, assertJsonPureProviderQuery } from '../../packages/content/src/runtime/server/providers'
import { lowerQueryPlan } from '../../packages/content/src/core/query/lower'
import { MAX_PROGRAMMATIC_QUERY_VALUE_DEPTH } from '../../packages/content/src/core/query/limits'
import { PROVIDER_QUERY_VERSION, toContentProviderQuery } from '../../packages/content/src/public/provider-query'
import type { ContentProvider } from '../../packages/content/src/public/provider'

// The provider registry imports Nitro/virtual modules at the top level; stub
// them so the pure helpers (`collectPlanFilterOperators`,
// `assertJsonPureProviderQuery`) can be exercised in isolation.
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}) }))
vi.mock('#content/virtual/providers', () => ({
  externalContentProviderNames: [],
  loadExternalContentProvider: () => undefined
}))

describe('provider query contract', () => {
  test('uses only the v5 provider wire with one collection authority', () => {
    expect(PROVIDER_QUERY_VERSION).toBe(5)
    const query = toContentProviderQuery({ collection: 'docs' })
    expect(query.v).toBe(5)
    expect(query.collection).toBe('docs')
    expect(query.plan).not.toHaveProperty('collection')
  })

  test('the context-free helper rejects selectors that require application policy', () => {
    expect(() => toContentProviderQuery({
      collection: 'docs',
      resolveVariant: { route: '/docs/intro' }
    } as never)).toThrow(/accepts only an explicit mounted providerPath selector/)
    expect(() => toContentProviderQuery({
      collection: 'docs',
      resolveVariant: { ref: 'docs.intro' }
    } as never)).toThrow(/accepts only an explicit mounted providerPath selector/)
  })

  describe('collectPlanFilterOperators — capability walker', () => {
    test('collects nested comparison operators without treating logical structure as capabilities', () => {
      const plan = lowerQueryPlan({
        collection: 'docs',
        where: [{
          $or: [
            { views: { $gt: 10 } },
            {
              $and: [
                { tags: { $contains: 'x' } },
                { $not: { title: { $icontains: 'draft' } } }
              ]
            }
          ]
        }]
      })

      expect([...collectPlanFilterOperators(plan.filter)].sort()).toEqual(
        ['$contains', '$gt', '$icontains'].sort()
      )
    })

    test('the identity filter uses no operators', () => {
      const plan = lowerQueryPlan({ collection: 'docs' })
      expect(plan.filter).toEqual({ type: 'true' })
      expect([...collectPlanFilterOperators(plan.filter)]).toEqual([])
    })

    test('a bare-value equality lowers to a single $eq operator', () => {
      const plan = lowerQueryPlan({ collection: 'docs', where: [{ locale: 'de' }] })
      expect([...collectPlanFilterOperators(plan.filter)]).toEqual(['$eq'])
    })
  })

  describe('JSON purity — regex operands survive the wire', () => {
    test('the default closed query survives an exact JSON round trip', () => {
      const query = toContentProviderQuery({})

      expect(JSON.parse(JSON.stringify(query))).toStrictEqual(query)
      expect(() => assertJsonPureProviderQuery({ name: 'unit' } as ContentProvider, query)).not.toThrow()
    })

    test('$regex operands lower to tagged JSON, never a RegExp instance', () => {
      const query = toContentProviderQuery({
        collection: 'docs',
        where: [{ title: { $regex: 'intro', $options: 'i' } }]
      })

      const roundTripped = JSON.parse(JSON.stringify(query))
      expect(roundTripped).toStrictEqual(query)
      expect(JSON.stringify(query)).not.toContain('{}')
    })

    test('a bare RegExp operand also lowers to a JSON-pure plan', () => {
      const query = toContentProviderQuery({
        collection: 'docs',
        where: [{ title: /intro/i }]
      })
      expect(JSON.parse(JSON.stringify(query))).toStrictEqual(query)
    })

    test('array operands lower nested RegExp and Date values to JSON-pure values', () => {
      const query = toContentProviderQuery({
        collection: 'docs',
        where: [{ title: { $in: [/^intro/i, new Date('2026-01-02T03:04:05.000Z')] } }]
      })

      expect(JSON.parse(JSON.stringify(query))).toStrictEqual(query)
      expect(query.plan.filter).toMatchObject({
        type: 'compare',
        field: 'title',
        operator: 'in',
        value: [
          { __ginkoContentQueryValue: 'RegExp', source: '^intro', flags: 'i' },
          '2026-01-02T03:04:05.000Z'
        ]
      })
    })

    test('plain data shaped like the old regex envelope remains ordinary data', () => {
      const query = toContentProviderQuery({
        collection: 'docs',
        where: [{ matcher: { $eq: { source: 'a+', flags: '' } } }]
      })

      expect(query.plan.filter).toMatchObject({
        type: 'compare',
        field: 'matcher',
        operator: 'eq',
        value: { source: 'a+', flags: '' }
      })
      expect(JSON.parse(JSON.stringify(query))).toStrictEqual(query)
    })

    test('stateful regex flags are rejected at lowering time', () => {
      expect(() => toContentProviderQuery({
        collection: 'docs',
        where: [{ title: /intro/g }]
      })).toThrow('Unsupported RegExp flags "g"')
    })

    test('slash-delimited string $regex flags honor the same [imsu] whitelist', () => {
      // Without the string-form guard this lowers cleanly and the executor
      // parses the trailing `g` into a stateful RegExp — the same bypass the
      // RegExp-literal path already rejects.
      expect(() => toContentProviderQuery({
        collection: 'docs',
        where: [{ title: { $regex: '/x/g' } }]
      })).toThrow('Unsupported RegExp flags "g"')

      // Supported flags (i, m, s, u) in the string form still lower fine.
      const query = toContentProviderQuery({
        collection: 'docs',
        where: [{ title: { $regex: '/x/imsu' } }]
      })
      expect(query.plan.filter).toMatchObject({
        type: 'compare',
        field: 'title',
        operator: 'regex',
        value: '/x/imsu'
      })
      // A plain (non-delimited) pattern carries no flags and is untouched.
      expect(() => toContentProviderQuery({
        collection: 'docs',
        where: [{ title: { $regex: 'intro' } }]
      })).not.toThrow()
    })

    test('rejects values that would change or disappear during a JSON round trip', () => {
      class QueryClass {
        value = 1
      }
      const sparse = new Array(1)
      const symbolKeyed = { visible: true } as Record<PropertyKey, unknown>
      symbolKeyed[Symbol('hidden')] = 'value'
      const circular: Record<string, unknown> = {}
      circular.self = circular

      const invalid = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        1n,
        new Map([['key', 'value']]),
        new Set(['value']),
        new QueryClass(),
        [1, undefined],
        sparse,
        symbolKeyed,
        circular,
        new Date('invalid')
      ]

      for (const value of invalid) {
        expect(() => toContentProviderQuery({
          collection: 'docs',
          where: [{ field: { $eq: value } }] as never
        })).toThrow(/Invalid content query value/)
      }
    })

    test('rejects unsupported object instances before they can collapse into a match-all filter', () => {
      expect(() => toContentProviderQuery({
        collection: 'docs',
        where: [{ field: new Map() }] as never
      })).toThrow(/Invalid content query value/)
    })

    test('rejects deeply nested programmatic values with a path-bearing query error', () => {
      const nest = (depth: number, wrap: (value: unknown) => unknown): unknown => {
        let value: unknown = 'value'
        for (let level = 0; level < depth; level += 1) value = wrap(value)
        return value
      }

      // Arrays and objects both count toward the budget. The bounded value walk
      // must run before the unbounded JSON-purity walk, or either shape
      // exhausts the stack before any budget is checked.
      for (const [label, operand] of [
        ['array', nest(5_000, value => [value])],
        ['object', nest(5_000, value => ({ nested: value }))]
      ] as const) {
        expect(() => lowerQueryPlan({
          collection: 'docs',
          where: [{ field: { $eq: operand } }]
        } as never), label).toThrow(expect.objectContaining({
          name: 'ContentQueryInputError',
          path: expect.stringMatching(/^\$\.where/),
          message: expect.stringContaining(String(MAX_PROGRAMMATIC_QUERY_VALUE_DEPTH))
        }))
        expect(() => toContentProviderQuery({
          collection: 'docs',
          where: [{ field: { $eq: operand } }]
        } as never), label).not.toThrow(RangeError)
      }
    })

    test('accepts programmatic operands inside the value-depth budget', () => {
      let operand: unknown = 'value'
      for (let level = 0; level < 8; level += 1) operand = [operand]

      expect(() => lowerQueryPlan({
        collection: 'docs',
        where: [{ field: { $eq: operand } }]
      } as never)).not.toThrow()
    })

    test('rejects a programmatic sort locale that Intl cannot execute', () => {
      expect(() => toContentProviderQuery({
        collection: 'docs',
        sort: [{ title: 1, $locale: 'not_a_locale' }]
      })).toThrow(/Invalid content query sort locale/)
    })

    test('rejects empty and prototype-traversing field paths during programmatic lowering', () => {
      const invalidPaths = ['', 'meta..title', 'meta.__proto__.title', 'prototype.name', 'author.constructor.name']

      for (const field of invalidPaths) {
        expect(() => lowerQueryPlan({ where: [{ [field]: true }] } as never), `where: ${field}`)
          .toThrow(/Invalid query field path/)
        expect(() => lowerQueryPlan({ sort: [{ [field]: 1 }] } as never), `sort: ${field}`)
          .toThrow(/Invalid query field path/)
        expect(() => lowerQueryPlan({ only: [field] } as never), `only: ${field}`)
          .toThrow(/Invalid query field path/)
        expect(() => lowerQueryPlan({ without: [field] } as never), `without: ${field}`)
          .toThrow(/Invalid query field path/)
      }

      expect(() => lowerQueryPlan({
        where: [{ meta: { constructor: { name: 'Object' } } }]
      } as never)).toThrow(/Invalid query field path/)
    })

    test('rejects non-object top-level $not operands during programmatic lowering', () => {
      for (const value of [true, 'published', null, [{ published: true }]]) {
        expect(() => lowerQueryPlan({ where: [{ $not: value }] } as never))
          .toThrow(/\$not must contain a filter condition object/)
      }
    })

    test('owns typed operator validation in the canonical lowerer', () => {
      for (const [operator, operand] of [
        ['$exists', 'yes'],
        ['$type', 'function'],
        ['$in', 'published'],
        ['$nin', 'archived'],
        ['$containsAny', 'nuxt'],
        ['$icontains', 42],
        ['$prefix', 42],
        ['$regex', 42]
      ] as const) {
        expect(() => lowerQueryPlan({
          where: [{ title: { [operator]: operand } }]
        } as never), operator).toThrow()
      }
    })

    test('rejects malformed direct provider-lowering inputs instead of broadening them', () => {
      for (const params of [
        { where: { $and: [] } },
        { where: { $or: [] } },
        { where: { $not: {} } },
        { where: { meta: {} } },
        { where: { meta: { $eq: 'x', nested: true } } },
        { first: true, count: true },
        { first: true, paging: { mode: 'offset', skip: 0, limit: 10 } },
        { skip: 1, paging: { mode: 'offset', skip: 0, limit: 10 } },
        { sort: [{ title: 2 }] },
        { sort: [{ $numeric: true }] },
        { resolveVariant: { providerPath: '/docs/intro', ref: 'docs.intro' } },
        { collection: 'docs', filters: { published: true } },
        { where: null },
        { where: false },
        { where: 0 },
        { where: 'published' },
        { resolveLocale: { locale: 'en', fallbacks: ['de'] } },
        { resolveVariant: { providerPath: '/docs/intro', fallbacks: ['de'] } },
        { paging: { mode: 'offset', skip: 0, limit: 10, after: 'cursor' } },
        { paging: { mode: 'cursor', limit: 10, skip: 0 } }
      ]) {
        expect(() => toContentProviderQuery(params as never)).toThrow()
      }
    })
  })

  describe('assertJsonPureProviderQuery', () => {
    const provider = { name: 'unit' } as ContentProvider

    test('accepts a lowered wire query (regex operands are already JSON-pure)', () => {
      const query = toContentProviderQuery({ collection: 'docs', where: [{ title: { $regex: 'x' } }] })
      expect(() => assertJsonPureProviderQuery(provider, query)).not.toThrow()
    })

    test('rejects a corrupted wire query before provider dispatch', () => {
      const query = toContentProviderQuery({ collection: 'docs', where: [{ views: 1 }] })
      ;(query.plan.filter as { value?: unknown }).value = Number.NaN
      expect(() => assertJsonPureProviderQuery(provider, query)).toThrow(expect.objectContaining({
        statusMessage: 'provider_query_not_json_pure'
      }))
    })

    test('rejects an own undefined property that JSON would drop', () => {
      const query = toContentProviderQuery({ collection: 'docs' })
      ;(query.plan as unknown as Record<string, unknown>).optional = undefined

      expect(() => assertJsonPureProviderQuery(provider, query)).toThrow(expect.objectContaining({
        statusMessage: 'provider_query_not_json_pure',
        data: expect.objectContaining({ field: 'query.plan.optional' })
      }))
    })
  })
})
