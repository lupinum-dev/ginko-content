import { describe, expect, test, vi } from 'vitest'

import { collectPlanFilterOperators, assertJsonPureProviderQuery } from '../../packages/content/src/runtime/server/providers'
import { lowerQueryPlan } from '../../packages/content/src/core/query/lower'
import { toContentProviderQuery } from '../../packages/content/src/public/provider-query'
import type { ContentProvider } from '../../packages/content/src/public/provider'

// The provider registry imports Nitro/virtual modules at the top level; stub
// them so the pure helpers (`collectPlanFilterOperators`,
// `assertJsonPureProviderQuery`) can be exercised in isolation.
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}) }))
vi.mock('#content/virtual/providers', () => ({
  externalContentProviderNames: [],
  loadExternalContentProvider: () => undefined
}))

describe('provider wire contract (CS-5)', () => {
  describe('collectPlanFilterOperators — capability walker', () => {
    test('collects compare operators recursively through and/or/not, $-prefixed', () => {
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
    test('$regex operands lower to tagged JSON, never a RegExp instance', () => {
      const query = toContentProviderQuery({
        collection: 'docs',
        where: [{ title: { $regex: 'intro', $options: 'i' } }]
      })

      const roundTripped = JSON.parse(JSON.stringify(query))
      expect(roundTripped).toEqual(query)
      expect(JSON.stringify(query)).not.toContain('{}')
    })

    test('a bare RegExp operand also lowers to a JSON-pure plan', () => {
      const query = toContentProviderQuery({
        collection: 'docs',
        where: [{ title: /intro/i }]
      })
      expect(JSON.parse(JSON.stringify(query))).toEqual(query)
    })

    test('array operands lower nested RegExp and Date values to JSON-pure values', () => {
      const query = toContentProviderQuery({
        collection: 'docs',
        where: [{ title: { $in: [/^intro/i, new Date('2026-01-02T03:04:05.000Z')] } }]
      })

      expect(JSON.parse(JSON.stringify(query))).toEqual(query)
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
      expect(JSON.parse(JSON.stringify(query))).toEqual(query)
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
  })

  describe('assertJsonPureProviderQuery', () => {
    const provider = { name: 'unit' } as ContentProvider

    test('accepts a lowered wire query (regex operands are already JSON-pure)', () => {
      const query = toContentProviderQuery({ collection: 'docs', where: [{ title: { $regex: 'x' } }] })
      expect(() => assertJsonPureProviderQuery(provider, query)).not.toThrow()
    })
  })
})
