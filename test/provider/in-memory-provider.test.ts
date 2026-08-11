import { describe, expect, test } from 'vitest'
import { toContentProviderQuery } from '../../packages/content/src/public/provider-query'
import { createProviderQuery } from '../../packages/content/src/runtime/server/provider-query'
import { createInMemoryProvider } from '../support/provider-scenarios/provider'
import { createSaasI18nScenario } from '../support/provider-scenarios/scenarios'
import { createTestEvent } from '../support/provider-scenarios/event'
import { expectProviderError } from '../support/provider-scenarios/assertions'

describe('localized in-memory provider scenario', () => {
  const scenario = createSaasI18nScenario()
  const provider = createInMemoryProvider(scenario)
  const event = createTestEvent({ scenario, provider })

  test('returns concrete fallback facts for core to shape', async () => {
    const response = await provider.query(event, createProviderQuery({
      collection: 'docs',
      first: true,
      resolveVariant: {
        route: '/de/dokumentation/essentials/fallback-lab',
        locale: 'de',
        fallback: ['en']
      }
    }, scenario.runtime)) as { result?: Record<string, unknown> }

    expect(response.result).toMatchObject({
      title: 'Fallback Lab',
      locale: 'en',
      contentPath: '/docs/essentials/fallback-lab',
      routeVariants: [{ locale: 'en', contentPath: '/docs/essentials/fallback-lab' }]
    })
  })

  test('keeps strict locale misses observable', async () => {
    await expect(provider.query(event, createProviderQuery({
      collection: 'docs',
      first: true,
      resolveVariant: {
        route: '/de/dokumentation/essentials/fallback-lab',
        locale: 'de',
        exact: true,
        fallback: false
      }
    }, scenario.runtime))).resolves.toEqual({ result: undefined })
  })

  test('supports localized list, count, and raw navigation operations', async () => {
    await expect(provider.query(event, toContentProviderQuery({
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] },
      sort: [{ order: 1 }],
      only: ['title']
    }))).resolves.toMatchObject({
      result: [
        { title: 'Erste Schritte', locale: 'de' },
        { title: 'Markdown Syntax DE', locale: 'de' },
        { title: 'Fallback Lab', locale: 'en' }
      ],
      total: 3
    })

    const navigation = await provider.navigation!(event, toContentProviderQuery({
      collection: 'docs',
      resolveLocale: { locale: 'de', fallback: ['en'] }
    }), { locale: 'de' })
    expect(navigation.map(item => item.route?.contentPath)).toContain('/dokumentation/erste-schritte')
    expect(navigation.map(item => item.route?.contentPath)).toContain('/docs/essentials/fallback-lab')
  })

  test('fails loudly for invalid operators and unknown collections', async () => {
    expect(() => toContentProviderQuery({
      collection: 'docs',
      where: { title: { $near: 'launch' } } as never
    })).toThrow(/Unsupported content query operator: \$near/)

    await expectProviderError(provider.query(event, toContentProviderQuery({
      collection: 'missing'
    })), 'unknown_collection', { collection: 'missing' })
  })
})
