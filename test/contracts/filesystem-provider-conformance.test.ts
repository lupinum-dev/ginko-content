import { describe, expect, test, vi } from 'vitest'
import { createEvent } from './_utils'
import { runProviderContractSuite } from '../../packages/content/src/testing/provider-contract'
import { toContentProviderQuery } from '../../packages/content/src/public/provider-query'
import type { ContentProviderCapabilities } from '../../packages/content/src/public/provider'

const providerError = (code: string, details: Record<string, unknown> = {}) => Object.assign(new Error(code), {
  statusCode: code === 'missing_locale_route' ? 404 : 400,
  statusMessage: code,
  data: { code, ...details }
})

vi.mock('../../packages/content/src/runtime/server/query-executor', () => ({
  // Receives a lowered ContentQueryPlan (CS-5), not builder params.
  executeFilesystemContentQuery: vi.fn(async (_event, plan) => {
    if (plan.collection === 'missing') {
      throw providerError('unknown_collection', { collection: 'missing' })
    }
    if (plan.collection === 'versions') {
      return { result: [{ title: 'Launch readiness' }], total: 1 }
    }
    if (plan.mode === 'count') {
      return { result: 1 }
    }
    if (plan.paging?.mode === 'cursor') {
      return {
        mode: 'cursor',
        result: [
          {
            title: 'Mehrsprachiges Onboarding',
            path: '/magazin/mehrsprachiges-onboarding',
            locale: 'de'
          }
        ],
        limit: plan.paging.limit,
        pageInfo: { endCursor: null, hasNext: false }
      }
    }
    return {
      result: [
        {
          title: 'Mehrsprachiges Onboarding',
          path: '/magazin/mehrsprachiges-onboarding',
          locale: 'de'
        }
      ],
      total: 1
    }
  })
}))

vi.mock('../../packages/content/src/runtime/server/navigation-query', () => ({
  resolveContentNavigation: vi.fn(async () => [
    { title: 'Einstieg', path: '/dokumentation/einstieg' }
  ])
}))

vi.mock('../../packages/content/src/runtime/server/collection-helpers', () => ({
  queryFilesystemCollectionNavigation: vi.fn(async () => [
    { title: 'Einstieg', description: 'Start here', path: '/dokumentation/einstieg', locale: 'de', ref: 'docs.getting-started', stableId: 'docs.getting-started' },
    { title: 'Installation', path: '/dokumentation/einstieg/installation', locale: 'de', ref: 'docs.installation', stableId: 'docs.installation' }
  ]),
  queryFilesystemCollectionItemSurroundings: vi.fn(async () => [
    { title: 'Alltag', unprefixedPath: '/dokumentation/einstieg/alltag', path: '/de/dokumentation/einstieg/alltag' },
    null
  ]),
  queryFilesystemCollectionSearchSections: vi.fn(async () => [
    {
      id: '/de/dokumentation/einstieg#intro',
      title: 'Einstieg',
      titles: ['Einstieg'],
      content: 'Einstieg'
    }
  ]),
  queryFilesystemCollectionPage: vi.fn(async (event, collection, routeOrPath) => {
    if (routeOrPath === '/de/dokumentation/not-found') {
      return null
    }
    event.context.__contentRuntime ||= { memo: {} }
    event.context.__contentRuntime.cacheHint = {
      tags: ['entry:posts:posts.onboarding', 'entry:authors:emily', 'collection:posts', 'route:/de/magazin/mehrsprachiges-onboarding'],
      paths: ['/de/magazin/mehrsprachiges-onboarding']
    }
    return {
      title: 'Einstieg',
      locale: 'de',
      path: '/de/dokumentation/einstieg',
      defaultLocale: 'en',
      resolved: {
        requestedLocale: 'de',
        locale: 'de',
        fallback: false
      },
      variants: [
        { locale: 'en', path: '/docs/getting-started' },
        { locale: 'de', path: '/de/dokumentation/einstieg' }
      ],
      localePaths: {
        en: '/docs/getting-started',
        de: '/de/dokumentation/einstieg'
      }
    }
  }),
  queryFilesystemCollectionRouteMeta: vi.fn(async () => ({
    path: '/de/dokumentation/einstieg',
    locale: 'de',
    defaultLocale: 'en',
    resolved: {
      requestedLocale: 'de',
      locale: 'de',
      fallback: false
    },
    variants: [
      { locale: 'en', path: '/docs/getting-started' },
      { locale: 'de', path: '/de/dokumentation/einstieg' }
    ],
    title: 'Einstieg'
  }))
}))

vi.mock('../../packages/content/src/runtime/server/sitemap', () => ({
  queryFilesystemCollectionsSitemapEntries: vi.fn(async (_event, options) => {
    if (options?.include?.includes('versions')) {
      throw providerError('data_collection_sitemap_access', { collection: 'versions' })
    }
    return [
    { loc: 'https://example.test/de/dokumentation/einstieg' }
    ]
  })
}))

describe('filesystem provider conformance', () => {
  const collectNavPaths = (items: Array<{ path?: string, children?: any[] }>): string[] =>
    items.flatMap(item => [
      item.path,
      ...collectNavPaths(item.children || [])
    ].filter(Boolean) as string[])

  const filesystemCapabilities: ContentProviderCapabilities = {
    routeBackedCollections: true,
    dataCollections: true,
    localizedRoutes: true,
    translatedSlugs: true,
    navigation: true,
    surroundings: true,
    searchSections: true,
    sitemap: true,
    query: { operators: ['$eq', '$contains'], pagination: ['offset', 'cursor'] }
  }

  runProviderContractSuite({
    name: 'filesystem',
    expectedProviderName: 'filesystem',
    loadProvider: async () => {
      const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')
      return filesystemProvider
    },
    createEvent,
    expectedCapabilities: filesystemCapabilities,
    collectNavPaths
  })

  test('accepts public prefix filters advertised by the query contract', async () => {
    const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')

    await expect(filesystemProvider.query(createEvent(), toContentProviderQuery({
      collection: 'posts',
      where: { path: { $prefix: '/magazin' } }
    }))).resolves.toMatchObject({
      result: expect.any(Array)
    })
  })

  test('rejects standalone regex options instead of treating them as match-all filters', async () => {
    const { filesystemProvider } = await import('../../packages/content/src/runtime/server/providers/filesystem')

    expect(filesystemProvider.capabilities.query.operators).not.toContain('$options')
    // Standalone `$options` is rejected while lowering to the wire plan (CS-5),
    // before the provider is reached.
    expect(() => toContentProviderQuery({
      collection: 'posts',
      where: { title: { $options: 'i' } }
    })).toThrow('$options requires $regex')
  })
})
