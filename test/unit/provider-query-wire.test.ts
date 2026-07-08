import { describe, expect, test, vi } from 'vitest'

// The provider registry imports Nitro/virtual modules at the top level; stub
// them so the pure helpers (`collectPlanFilterOperators`,
// `assertJsonPureProviderQuery`) can be exercised in isolation.
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({}) }))
vi.mock('#content/virtual/providers', () => ({
  externalContentProviderNames: [],
  loadExternalContentProvider: () => undefined
}))

import { collectPlanFilterOperators, assertJsonPureProviderQuery } from '../../packages/content/src/runtime/server/providers'
import { lowerQueryPlan } from '../../packages/content/src/core/query/lower'
import { toContentProviderQuery } from '../../packages/content/src/public/provider-query'
import type { ContentProvider } from '../../packages/content/src/public/provider'

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
    test('$regex operands lower to { source, flags }, never a RegExp instance', () => {
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
  })

  describe('assertJsonPureProviderQuery', () => {
    const provider = { name: 'unit' } as ContentProvider

    test('accepts a lowered wire query (regex operands are already JSON-pure)', () => {
      const query = toContentProviderQuery({ collection: 'docs', where: [{ title: { $regex: 'x' } }] })
      expect(() => assertJsonPureProviderQuery(provider, query)).not.toThrow()
    })
  })
})
