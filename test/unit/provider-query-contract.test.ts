import { describe, expect, test, vi } from 'vitest'

import { collectPlanFilterOperators, assertJsonPureProviderQuery } from '../../packages/content/src/runtime/server/providers'
import { lowerQueryPlan } from '../../packages/content/src/core/query/lower'
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
  test('uses only the v3 provider wire', () => {
    expect(PROVIDER_QUERY_VERSION).toBe(3)
    expect(toContentProviderQuery({ collection: 'docs' }).v).toBe(3)
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
        { resolveVariant: { path: '/docs/intro', ref: 'docs.intro' } },
        { collection: 'docs', filters: { published: true } },
        { where: null },
        { where: false },
        { where: 0 },
        { where: 'published' },
        { resolveLocale: { locale: 'en', fallbacks: ['de'] } },
        { resolveVariant: { path: '/docs/intro', fallbacks: ['de'] } },
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
