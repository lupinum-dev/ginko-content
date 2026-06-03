import { describe, expect, test } from 'vitest'
import { defineCollection, defineContentConfig } from '../../packages/content/src/types/config'
import { createInMemoryProvider } from '../harness/provider'
import { createSaasI18nScenario } from '../harness/scenarios'
import { createTestEvent } from '../harness/event'

const scenario = createSaasI18nScenario()
const provider = createInMemoryProvider(scenario)
const event = createTestEvent({ scenario, provider })
const context = {
  runtime: scenario.runtime,
  transport: (endpoint: 'query' | 'navigation', params: any) => {
    if (endpoint === 'navigation') {
      return provider.navigationQuery(event, params)
    }
    return provider.query(event, params)
  }
}

const contentConfig = defineContentConfig({
  collections: {
    docs: defineCollection({
      type: 'page',
      source: 'docs/**/*',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      route: { en: '/docs', de: '/dokumentation' }
    }),
    posts: defineCollection({
      type: 'page',
      source: 'posts/**/*',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      route: '/blog'
    }),
    authors: defineCollection({
      type: 'page',
      source: 'authors/**/*',
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      route: { en: '/authors', de: '/autoren' }
    })
  }
})

const { docs, posts, authors } = contentConfig.collections

describe('public client query flows against an in-memory content scenario', () => {
  test('does not invent locale-prefixed paths for non-i18n runtime results', async () => {
    const { one } = await import('../../packages/content/src/runtime/query/unified')
    const plainConfig = defineContentConfig({
      collections: {
        plain: defineCollection({
          type: 'page',
          source: 'plain/**/*',
          route: '/plain'
        })
      }
    })
    const plain = plainConfig.collections.plain

    const page = await one({
      runtime: {
        collections: {
          plain: { route: '/plain' }
        }
      },
      transport: async () => ({
        _path: '/plain/about',
        _file: 'plain/about.md',
        _locale: 'en',
        _variantPaths: {
          en: '/plain/about'
        },
        title: 'About'
      })
    }, plain, {
      by: { route: '/plain/about' }
    })

    expect(page).toMatchObject({
      path: '/plain/about',
      canonicalPath: '/plain/about',
      localePaths: {},
      variants: []
    })
  })

  test('resolves one document by localized route with fallback metadata', async () => {
    const { one } = await import('../../packages/content/src/runtime/query/unified')

    const page = await one(context, docs, {
      locale: 'de',
      fallback: true,
      by: { route: '/de/dokumentation/essentials/fallback-lab' }
    })

    expect(page).toMatchObject({
      title: 'Fallback Lab',
      path: '/de/dokumentation/essentials/fallback-lab',
      locale: 'de',
      resolved: {
        locale: 'en',
        fallback: true
      }
    })
  })

  test('keeps route and locale metadata when callers select content fields', async () => {
    const { one } = await import('../../packages/content/src/runtime/query/unified')

    const page = await one(context, docs, {
      locale: 'de',
      fallback: true,
      by: { route: '/de/dokumentation/essentials/fallback-lab' },
      select: ['title']
    })

    expect(page).toMatchObject({
      title: 'Fallback Lab',
      path: '/de/dokumentation/essentials/fallback-lab',
      canonicalPath: '/docs/essentials/fallback-lab',
      locale: 'de',
      defaultLocale: 'en',
      localePaths: {
        en: {
          path: '/docs/essentials/fallback-lab',
          translated: true
        },
        de: {
          path: '/de/dokumentation/essentials/fallback-lab',
          translated: false
        }
      },
      resolved: {
        locale: 'en',
        requestedLocale: 'de',
        fallback: true,
        fallbackLocale: 'en',
        path: '/de/dokumentation/essentials/fallback-lab',
        availableLocales: ['en']
      }
    })
  })

  test('runs consumer-style many, tree, variants, neighbors, resolve, and populate flows', async () => {
    const { many, neighbors, resolveOne, tree, variants, one } = await import('../../packages/content/src/runtime/query/unified')

    await expect(many(context, posts, {
      locale: 'de',
      fallback: true,
      sort: { date: 'desc' }
    })).resolves.toEqual([
      expect.objectContaining({
        title: 'Kryptowaehrungen',
        path: '/de/blog/kryptowaehrungen'
      })
    ])

    await expect(tree(context, docs, {
      locale: 'de',
      fields: ['description']
    })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Erste Schritte',
          path: '/de/dokumentation/erste-schritte'
        }),
        expect.objectContaining({
          title: 'Fallback Lab',
          path: '/de/dokumentation/essentials/fallback-lab'
        })
      ])
    )

    await expect(variants(context, docs, {
      locale: 'de',
      by: { path: '/docs/essentials/fallback-lab' }
    })).resolves.toEqual([
      { locale: 'en', path: '/docs/essentials/fallback-lab', translated: true },
      { locale: 'de', path: '/de/dokumentation/essentials/fallback-lab', translated: false, fallback: 'de' }
    ])

    await expect(neighbors(context, docs, {
      locale: 'de',
      fallback: true,
      by: { route: '/de/dokumentation/grundlagen/markdown-syntax' },
      fields: ['description']
    })).resolves.toMatchObject({
      prev: { title: 'Erste Schritte' },
      next: { title: 'Fallback Lab' }
    })

    await expect(resolveOne(context, docs, {
      locale: 'de',
      fallback: true,
      by: { route: '/de/dokumentation/missing' }
    })).resolves.toMatchObject({
      doc: null,
      explain: {
        matched: {
          found: false
        }
      }
    })

    const populatedPost = await one(context, posts, {
      locale: 'de',
      fallback: true,
      by: { route: '/de/blog/kryptowaehrungen' },
      populate: { authors }
    })
    expect(populatedPost).toMatchObject({
      title: 'Kryptowaehrungen',
      authors: expect.arrayContaining([
        expect.objectContaining({
          title: 'Emily DE',
          path: '/de/autoren/emily'
        })
      ])
    })
  })
})
