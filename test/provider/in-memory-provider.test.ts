import { describe, expect, test } from 'vitest'
import { createInMemoryProvider } from '../harness/provider'
import { createSaasI18nScenario } from '../harness/scenarios'
import { createTestEvent } from '../harness/event'
import { expectLocalizedDocument, expectProviderError } from '../harness/assertions'

describe('in-memory provider scenario harness', () => {
  const scenario = createSaasI18nScenario()
  const provider = createInMemoryProvider(scenario)
  const event = createTestEvent({ scenario, provider })

  test('executes locale-aware route fallback through the real core query executor', async () => {
    const page = await provider.page(event, 'docs', '/de/dokumentation/essentials/fallback-lab', {
      locale: 'de',
      fallback: true
    })

    expect(page).toMatchObject({
      title: 'Fallback Lab',
      resolved: { requestedRoute: '/de/dokumentation/essentials/fallback-lab' }
    })
    expectLocalizedDocument(page, {
      path: '/de/dokumentation/essentials/fallback-lab',
      locale: 'de',
      resolvedLocale: 'en',
      fallback: true
    })
  })

  test('keeps strict locale misses observable without starting Nuxt', async () => {
    await expect(provider.page(event, 'docs', '/de/dokumentation/essentials/fallback-lab', {
      locale: 'de',
      exact: true,
      fallback: false
    })).resolves.toBeNull()
  })

  test('supports list queries, projection, count, and navigation from the same scenario', async () => {
    await expect(provider.query(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      sort: [{ order: 1 }],
      only: ['title', 'resolved']
    })).resolves.toMatchObject({
      result: [
        { title: 'Erste Schritte', resolved: { locale: 'de', fallback: false } },
        { title: 'Markdown Syntax DE', resolved: { locale: 'de', fallback: false } },
        { title: 'Fallback Lab', resolved: { locale: 'en', fallback: true } }
      ],
      total: 3
    })

    await expect(provider.query(event, {
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      count: true
    })).resolves.toEqual({ result: 3 })

    const navigation = await provider.navigation(event, 'docs', { locale: 'de' })
    expect(navigation.map(item => item.path)).toContain('/de/dokumentation/erste-schritte')
    expect(navigation.map(item => item.path)).toContain('/de/dokumentation/essentials/fallback-lab')
  })

  test('fails loudly for unsupported operators, unknown collections, and data-only sitemap access', async () => {
    await expectProviderError(provider.query(event, {
      collection: 'docs',
      where: { title: { $near: 'launch' } } as never
    }), 'unsupported_query_operator', { operator: '$near' })

    await expectProviderError(provider.query(event, {
      collection: 'missing'
    }), 'unknown_collection', { collection: 'missing' })

    await expectProviderError(provider.sitemapEntries(event, {
      include: ['versions']
    }), 'data_collection_sitemap_access', { collection: 'versions' })
  })
})
