import { describe, expect } from 'vitest'
import provider from '../../playground/ginko-provider-search/server/provider'
import { toContentProviderQuery } from '../../packages/content/src/public/provider-query'
import { runProviderContractSuite } from '../../packages/content/src/testing/provider-contract'

const assertTitles = (expected: string[]) => (result: unknown) => {
  expect((result as { result: Array<{ title: string }> }).result.map(document => document.title)).toEqual(expected)
}

describe('provider-search playground conformance', () => {
  runProviderContractSuite({
    name: 'provider-search playground',
    expectedProviderName: 'fixture-search',
    loadProvider: async () => provider,
    createEvent: () => ({ context: {} }),
    expectedCapabilities: provider.capabilities,
    operatorProbes: {
      $eq: {
        positive: toContentProviderQuery({
          collection: 'docs',
          where: { locale: { $eq: 'missing' } }
        }),
        assertResult: assertTitles([])
      }
    },
    logicalProbes: {
      and: {
        positive: toContentProviderQuery({
          collection: 'docs',
          where: { $and: [{ locale: 'en' }, { locale: 'de' }] }
        }),
        assertResult: assertTitles([])
      },
      or: {
        positive: toContentProviderQuery({
          collection: 'docs',
          where: { $or: [{ locale: 'en' }, { locale: 'de' }] }
        }),
        assertResult: assertTitles(['Provider English Guide', 'Provider Deutscher Leitfaden'])
      },
      not: {
        positive: toContentProviderQuery({
          collection: 'docs',
          where: { $not: { locale: 'en' } }
        }),
        assertResult: assertTitles(['Provider Deutscher Leitfaden'])
      }
    },
    sortProbe: {
      positive: toContentProviderQuery({
        collection: 'docs',
        sort: [{ title: 1 }]
      }),
      assertResult: assertTitles(['Provider Deutscher Leitfaden', 'Provider English Guide'])
    },
    terminalProbes: {
      first: {
        positive: toContentProviderQuery({
          collection: 'docs',
          sort: [{ title: 1 }],
          first: true
        }),
        assertResult: result => expect(result).toMatchObject({
          result: { title: 'Provider Deutscher Leitfaden' }
        })
      },
      count: {
        positive: toContentProviderQuery({ collection: 'docs', count: true }),
        assertResult: result => expect(result).toEqual({ result: 2 })
      }
    },
    paginationProbes: {
      offset: {
        positive: toContentProviderQuery({
          collection: 'docs',
          sort: [{ title: 1 }],
          paging: { mode: 'offset', skip: 1, limit: 1 }
        }),
        assertResult: assertTitles(['Provider English Guide'])
      }
    }
  })
})
