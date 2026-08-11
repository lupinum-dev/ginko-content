import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ContentProviderCapabilities } from '../../packages/content/src/public/provider'
import { toContentProviderQuery } from '../../packages/content/src/public/provider-query'
import {
  runProviderContractSuite,
  type ProviderQueryProbe
} from '../../packages/content/src/testing/provider-contract'
import { PROVIDER_CAPABILITY_OPERATORS } from '../../packages/content/src/core/query/operators'
import { executeQueryPlanOnDocuments } from '../../packages/content/src/core/query/execute'
import { normalizeProviderQueryResponse } from '../../packages/content/src/runtime/server/provider-query'
import { executeFilesystemContentQuery } from '../../packages/content/src/runtime/server/query-executor'
import { createTestEvent } from '../support/provider-scenarios/event'

const documents = [
  {
    id: 'content:de:docs:einstieg.md',
    collection: 'docs',
    canonicalKey: 'docs:einstieg',
    locale: 'de',
    path: '/einstieg',
    title: 'Einstieg',
    tags: ['guide', 'start'],
    featured: true,
    rating: 5,
    order: 1,
    type: 'markdown',
    body: { type: 'root', children: [] }
  },
  {
    id: 'content:de:docs:zulu.md',
    collection: 'docs',
    canonicalKey: 'docs:zulu',
    locale: 'de',
    path: '/zulu',
    title: 'Zulu',
    order: 2,
    type: 'markdown',
    body: { type: 'root', children: [] }
  }
]

vi.mock('../../packages/content/src/runtime/server/query-executor', () => ({
  executeFilesystemContentQuery: vi.fn(async (_event, plan) =>
    executeQueryPlanOnDocuments(documents, plan))
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
    unprefixedPath: '/einstieg',
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
      contentPath: runtime.content.collections.docs.localePolicy.localized
        ? '/einstieg'
        : '/de/dokumentation/einstieg',
      path: '/de/dokumentation/einstieg'
    }]
  }))
}))

const operators = PROVIDER_CAPABILITY_OPERATORS

const capabilities: ContentProviderCapabilities = {
  query: { operators, pagination: ['offset', 'cursor'] }
}

const runtime = {
  content: {
    defaultLocale: 'de',
    locales: ['de'],
    collections: {
      docs: {
        i18n: { defaultLocale: 'de', locales: ['de'] },
        localePolicy: {
          localized: true,
          locales: ['de'],
          defaultLocale: 'de',
          fallback: {},
          translatedSlugs: false,
          routeMounts: { de: '/dokumentation' }
        }
      }
    }
  }
}

vi.mock('../../packages/content/src/runtime/server/runtime-config', () => ({
  getContentRuntimeConfig: () => runtime
}))

beforeEach(() => {
  runtime.content = {
    defaultLocale: 'de',
    locales: ['de'],
    collections: {
      docs: {
        i18n: { defaultLocale: 'de', locales: ['de'] },
        localePolicy: {
          localized: true,
          locales: ['de'],
          defaultLocale: 'de',
          fallback: {},
          translatedSlugs: false,
          routeMounts: { de: '/dokumentation' }
        }
      }
    }
  }
})

const assertTitles = (expected: string[]) => (result: unknown) => {
  const titles = (result as { result: Array<{ title: string }> }).result
    .map(item => item.title)
  expect(titles).toEqual(expected)
}

const operatorCases: Record<string, { where: Record<string, unknown>, titles: string[] }> = {
  $eq: { where: { title: { $eq: 'Einstieg' } }, titles: ['Einstieg'] },
  $ne: { where: { title: { $ne: 'Einstieg' } }, titles: ['Zulu'] },
  $gt: { where: { order: { $gt: 1 } }, titles: ['Zulu'] },
  $gte: { where: { order: { $gte: 2 } }, titles: ['Zulu'] },
  $lt: { where: { order: { $lt: 2 } }, titles: ['Einstieg'] },
  $lte: { where: { order: { $lte: 1 } }, titles: ['Einstieg'] },
  $in: { where: { title: { $in: ['Einstieg'] } }, titles: ['Einstieg'] },
  $nin: { where: { title: { $nin: ['Einstieg'] } }, titles: ['Zulu'] },
  $contains: { where: { tags: { $contains: 'guide' } }, titles: ['Einstieg'] },
  $containsAny: { where: { tags: { $containsAny: ['guide'] } }, titles: ['Einstieg'] },
  $icontains: { where: { title: { $icontains: 'ein' } }, titles: ['Einstieg'] },
  $exists: { where: { featured: { $exists: true } }, titles: ['Einstieg'] },
  $type: { where: { rating: { $type: 'number' } }, titles: ['Einstieg'] },
  $regex: { where: { title: { $regex: '^Ein' } }, titles: ['Einstieg'] },
  $prefix: { where: { path: { $prefix: '/e' } }, titles: ['Einstieg'] }
}

const operatorProbes = Object.fromEntries(operators.map(operator => [operator, {
  positive: toContentProviderQuery({ collection: 'docs', where: operatorCases[operator]!.where }),
  assertResult: assertTitles(operatorCases[operator]!.titles)
}])) as Record<string, ProviderQueryProbe>

describe('filesystem provider conformance', () => {
  runProviderContractSuite({
    name: 'filesystem',
    expectedProviderName: 'filesystem',
    loadProvider: async () => {
      const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')
      return filesystemProvider
    },
    createEvent: createTestEvent,
    expectedCapabilities: capabilities,
    operatorProbes,
    logicalProbes: {
      and: {
        positive: toContentProviderQuery({
          collection: 'docs',
          where: { $and: [{ title: { $eq: 'Einstieg' } }, { order: { $gte: 1 } }] }
        }),
        assertResult: assertTitles(['Einstieg'])
      },
      or: {
        positive: toContentProviderQuery({
          collection: 'docs',
          where: { $or: [{ title: { $eq: 'missing' } }, { order: { $eq: 1 } }] }
        }),
        assertResult: assertTitles(['Einstieg'])
      },
      not: {
        positive: toContentProviderQuery({
          collection: 'docs',
          where: { $not: { title: { $eq: 'Einstieg' } } }
        }),
        assertResult: assertTitles(['Zulu'])
      }
    },
    sortProbe: {
      positive: toContentProviderQuery({
        collection: 'docs',
        sort: [{ order: -1 }]
      }),
      assertResult: assertTitles(['Zulu', 'Einstieg'])
    },
    terminalProbes: {
      first: {
        positive: toContentProviderQuery({
          collection: 'docs',
          sort: [{ order: -1 }],
          first: true
        }),
        assertResult: result => expect(result).toMatchObject({ result: { title: 'Zulu' } })
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
          paging: { mode: 'offset', skip: 1, limit: 1 }
        }),
        assertResult: assertTitles(['Zulu'])
      },
      cursor: {
        positive: toContentProviderQuery({
          collection: 'docs',
          paging: { mode: 'cursor', after: null, limit: 1 }
        }),
        assertResult: assertTitles(['Einstieg'])
      }
    }
  })

  test('converts internal filesystem documents into raw provider documents', async () => {
    const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')
    const response = await filesystemProvider.query(createTestEvent(), toContentProviderQuery({ collection: 'docs' })) as {
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

  test('canonicalizes a provider path against its explicit locale mount', async () => {
    runtime.content = {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      collections: {
        docs: {
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
          localePolicy: {
            localized: true,
            locales: ['en', 'de'],
            defaultLocale: 'en',
            fallback: { de: ['en'] },
            translatedSlugs: true,
            routeMounts: { en: '/guide', de: '/leitfaden' }
          }
        }
      }
    } as typeof runtime.content
    vi.mocked(executeFilesystemContentQuery).mockClear()
    const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')

    await filesystemProvider.query(createTestEvent(), toContentProviderQuery({
      collection: 'docs',
      resolveVariant: {
        providerPath: '/leitfaden/advanced',
        locale: 'de',
        fallback: ['en']
      },
      first: true
    }))

    expect(executeFilesystemContentQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        variant: {
          by: 'path',
          canonicalPath: '/advanced',
          locale: 'de',
          fallback: ['en']
        }
      })
    )
  })

  test('rejects a provider path mounted for a fallback locale', async () => {
    runtime.content = {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      collections: {
        docs: {
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
          localePolicy: {
            localized: true,
            locales: ['en', 'de'],
            defaultLocale: 'en',
            fallback: { de: ['en'] },
            translatedSlugs: true,
            routeMounts: { en: '/guide', de: '/leitfaden' }
          }
        }
      }
    } as typeof runtime.content
    const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')

    await expect(filesystemProvider.query(createTestEvent(), toContentProviderQuery({
      collection: 'docs',
      resolveVariant: {
        providerPath: '/guide/advanced',
        locale: 'de',
        fallback: ['en']
      },
      first: true
    }))).rejects.toThrow(/outside the configured mount "\/leitfaden" for locale "de"/)
  })

  test.each([
    { projection: { only: ['title'] }, retained: 'title' },
    { projection: { without: ['collection', 'canonicalKey', 'locale'] }, retained: 'title' }
  ])('keeps provider identity intact until canonical $retained projection', async ({ projection }) => {
    const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')
    const params = { collection: 'docs', limit: 2, ...projection }
    const raw = await filesystemProvider.query(createTestEvent(), toContentProviderQuery(params))
    const rawDocuments = (raw as { result: Array<Record<string, unknown>> }).result

    expect(rawDocuments).toHaveLength(2)
    expect(rawDocuments[0]).toEqual(expect.objectContaining({
      collection: 'docs',
      canonicalKey: expect.any(String),
      locale: 'de',
      contentPath: expect.stringMatching(/^\//)
    }))
    expect(() => normalizeProviderQueryResponse(params, raw, 'filesystem')).not.toThrow()

    const normalized = normalizeProviderQueryResponse<Record<string, unknown>>(params, raw, 'filesystem')
    if ('only' in projection) {
      expect(normalized.result[0]).toHaveProperty('title')
      expect(normalized.result[0]).not.toHaveProperty('order')
    } else {
      expect(normalized.result[0]).not.toHaveProperty('collection')
      expect(normalized.result[0]).not.toHaveProperty('canonicalKey')
      expect(normalized.result[0]).not.toHaveProperty('locale')
    }
  })

  test('does not strip a global locale prefix from an explicitly unlocalized collection route', async () => {
    runtime.content = {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      collections: {
        docs: {
          i18n: false,
          localePolicy: {
            localized: false,
            locales: [],
            defaultLocale: 'en',
            fallback: {},
            translatedSlugs: false,
            routeMounts: { default: '/docs' }
          }
        }
      }
    } as typeof runtime.content
    const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')

    await expect(filesystemProvider.routes!(createTestEvent())).resolves.toEqual([
      expect.objectContaining({
        collection: 'docs',
        locale: 'de',
        contentPath: '/docs/de/dokumentation/einstieg'
      })
    ])
  })

  test('rejects standalone regex options during wire lowering', () => {
    expect(() => toContentProviderQuery({
      collection: 'posts',
      where: { title: { $options: 'i' } }
    })).toThrow('$options requires $regex')
  })
})
