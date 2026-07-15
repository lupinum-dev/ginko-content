import { describe, expect, test, vi } from 'vitest'
import type { ContentProviderCapabilities } from '../../packages/content/src/public/provider'
import { toContentProviderQuery } from '../../packages/content/src/public/provider-query'
import {
  runProviderContractSuite,
  type ProviderQueryProbe
} from '../../packages/content/src/testing/provider-contract'
import { createEvent } from './_utils'

const document = {
  id: 'content:de:docs:einstieg.md',
  collection: 'docs',
  canonicalKey: 'docs:einstieg',
  locale: 'de',
  path: '/dokumentation/einstieg',
  title: 'Einstieg',
  order: 1,
  type: 'markdown',
  body: { type: 'root', children: [] }
}

vi.mock('../../packages/content/src/runtime/server/query-executor', () => ({
  executeFilesystemContentQuery: vi.fn(async (_event, plan) => {
    if (plan.mode === 'count') return { result: 1 }
    if (plan.paging?.mode === 'cursor') {
      return {
        mode: 'cursor',
        result: [document],
        limit: plan.paging.limit,
        pageInfo: { endCursor: null, hasNext: false }
      }
    }
    return {
      result: plan.mode === 'first' ? document : [document],
      skip: plan.skip,
      limit: plan.limit,
      total: 1
    }
  })
}))

vi.mock('../../packages/content/src/runtime/server/navigation-query', () => ({
  resolveContentNavigation: vi.fn(async () => [{
    title: 'Einstieg',
    path: '/de/dokumentation/einstieg',
    canonicalKey: 'docs:einstieg',
    locale: 'de'
  }])
}))

vi.mock('../../packages/content/src/runtime/server/collection-helpers', () => ({
  queryFilesystemCollectionItemSurroundings: vi.fn(async () => [{
    title: 'Einstieg',
    path: '/de/dokumentation/einstieg',
    canonicalKey: 'docs:einstieg',
    locale: 'de'
  }, null])
}))

vi.mock('../../packages/content/src/integrations/nitro/build', () => ({
  buildContentResult: vi.fn(async () => ({
    routes: [{
      collection: 'docs',
      canonicalKey: 'docs:einstieg',
      locale: 'de',
      path: '/de/dokumentation/einstieg'
    }]
  }))
}))

const operators = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
  '$contains', '$containsAny', '$icontains', '$exists', '$type',
  '$regex', '$prefix', '$not', '$and', '$or'
] as const

const capabilities: ContentProviderCapabilities = {
  query: { operators, pagination: ['offset', 'cursor'] }
}

const simpleWhere = (operator: string) => operator === '$and'
  ? { $and: [{ title: { $exists: true } }] }
  : operator === '$or'
    ? { $or: [{ title: { $exists: true } }] }
    : operator === '$not'
      ? { $not: { title: { $eq: 'never' } } }
      : { title: { [operator]: operator === '$exists' ? true : operator === '$type' ? 'string' : operator === '$in' || operator === '$nin' || operator === '$containsAny' ? ['Einstieg'] : 'Einstieg' } }

const operatorProbes = Object.fromEntries(operators.map(operator => [operator, {
  positive: toContentProviderQuery({ collection: 'docs', where: simpleWhere(operator) })
}])) as Record<string, ProviderQueryProbe>

describe('filesystem provider conformance', () => {
  runProviderContractSuite({
    name: 'filesystem',
    expectedProviderName: 'filesystem',
    loadProvider: async () => {
      const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')
      return filesystemProvider
    },
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

  test('converts internal filesystem documents into raw provider documents', async () => {
    const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')
    const response = await filesystemProvider.query(createEvent(), toContentProviderQuery({ collection: 'docs' })) as {
      result: Array<Record<string, unknown>>
    }
    expect(response.result[0]).toEqual(expect.objectContaining({
      collection: 'docs',
      canonicalKey: 'docs:einstieg',
      locale: 'de',
      contentPath: '/dokumentation/einstieg'
    }))
    expect(response.result[0]).not.toHaveProperty('route')
    expect(response.result[0]).not.toHaveProperty('resolution')
  })

  test('rejects standalone regex options during wire lowering', () => {
    expect(() => toContentProviderQuery({
      collection: 'posts',
      where: { title: { $options: 'i' } }
    })).toThrow('$options requires $regex')
  })
})
