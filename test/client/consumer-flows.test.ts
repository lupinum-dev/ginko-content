import { describe, expect, test } from 'vitest'
import { defineCollection, defineContentConfig } from '../../packages/content/src/types/config'
import { createInMemoryProvider } from '../harness/provider'
import { createSaasI18nScenario } from '../harness/scenarios'
import { createTestEvent } from '../harness/event'
import { createProviderQuery, normalizeProviderQueryResponse } from '../../packages/content/src/runtime/server/provider-query'
import { projectProviderNavigation } from '../../packages/content/src/runtime/server/provider-route-facts'
import { projectPublicQueryResponse } from '../../packages/content/src/features/query/responses'

const scenario = createSaasI18nScenario()
const provider = createInMemoryProvider(scenario)
const event = createTestEvent({ scenario, provider })
const publicDocument = (path: string, fields: Record<string, unknown> = {}) => ({
  ...fields,
  locale: 'en',
  route: { resolvedPath: path, alternates: [] },
  resolution: {
    requested: {},
    resolved: { locale: 'en' },
    usedFallback: false
  }
})
const context = {
  runtime: scenario.runtime,
  transport: (endpoint: 'query' | 'navigation', params: any) => {
    if (endpoint === 'navigation') {
      const query = createProviderQuery(params, scenario.runtime)
      return provider.navigation!(event, query)
        .then(items => projectProviderNavigation(
          items,
          provider.name,
          scenario.runtime,
          query.plan.resolveLocale?.locale,
          query.collection || undefined
        ))
    }
    return provider.query(event, createProviderQuery(params, scenario.runtime))
      .then(response => projectPublicQueryResponse(
        normalizeProviderQueryResponse(params, response, provider.name, scenario.runtime),
        params.first === true,
      ))
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
    const { one } = await import('../../packages/content/src/features/query/unified')
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
        result: publicDocument('/plain/about', {
          file: { path: 'plain/about.md' },
          title: 'About'
        })
      })
    }, plain, {
      by: { route: '/plain/about' }
    })

    expect(page).toMatchObject({
      route: {
        resolvedPath: '/plain/about',
        alternates: []
      }
    })
  })

  test('uses the first visible navigation item as the collection root surround next entry', async () => {
    const { surround } = await import('../../packages/content/src/features/query/unified')

    const result = await surround({
      runtime: {
        collections: {
          docs: {}
        }
      },
      transport: async (endpoint) => {
        if (endpoint === 'navigation') {
          return [
            {
              title: 'Getting Started',
              path: '/docs/getting-started'
            }
          ]
        }
        return {
          result: publicDocument('/docs', { title: 'Docs' })
        }
      }
    }, 'docs', {
      by: { route: '/docs' }
    })

    expect(result).toEqual({
      previous: null,
      next: expect.objectContaining({
        title: 'Getting Started',
        path: '/docs/getting-started'
      })
    })
  })

  test('skips page:false control nodes in navigation-backed surroundings', async () => {
    const { surround } = await import('../../packages/content/src/features/query/unified')

    const result = await surround({
      runtime: { collections: { docs: {} } },
      transport: async (endpoint) => endpoint === 'navigation'
        ? [
            { title: 'Control', path: '/docs/control', page: false },
            { title: 'Getting Started', path: '/docs/getting-started' }
          ]
        : { result: publicDocument('/docs', { title: 'Docs' }) }
    }, 'docs', {
      by: { route: '/docs' }
    })

    expect(result.next).toEqual(expect.objectContaining({
      title: 'Getting Started',
      path: '/docs/getting-started'
    }))
  })

  test('does not treat hidden non-root pages as collection roots', async () => {
    const { surround } = await import('../../packages/content/src/features/query/unified')

    const result = await surround({
      runtime: {
        collections: {
          docs: {}
        }
      },
      transport: async (endpoint) => {
        if (endpoint === 'navigation') {
          return [
            {
              title: 'Getting Started',
              path: '/docs/getting-started'
            }
          ]
        }
        return {
          result: publicDocument('/docs/hidden', { title: 'Hidden' })
        }
      }
    }, 'docs', {
      by: { route: '/docs/hidden' }
    })

    expect(result).toEqual({
      previous: null,
      next: null
    })
  })

  test('resolves one document by localized route with fallback metadata', async () => {
    const { one } = await import('../../packages/content/src/features/query/unified')

    const page = await one(context, docs, {
      locale: 'de',
      fallback: true,
      by: { route: '/de/dokumentation/essentials/fallback-lab' }
    })

    expect(page).toMatchObject({
      title: 'Fallback Lab',
      locale: 'en',
      route: {
        requestedPath: '/de/dokumentation/essentials/fallback-lab',
        resolvedPath: '/docs/essentials/fallback-lab'
      },
      resolution: {
        requested: { locale: 'de' },
        resolved: { locale: 'en' },
        usedFallback: true
      }
    })
  })

  test('keeps route and locale metadata when callers select content fields', async () => {
    const { one } = await import('../../packages/content/src/features/query/unified')

    const page = await one(context, docs, {
      locale: 'de',
      fallback: true,
      by: { route: '/de/dokumentation/essentials/fallback-lab' },
      select: ['title']
    })

    expect(page).toMatchObject({
      title: 'Fallback Lab',
      locale: 'en',
      route: {
        requestedPath: '/de/dokumentation/essentials/fallback-lab',
        resolvedPath: '/docs/essentials/fallback-lab',
        alternates: expect.arrayContaining([
          expect.objectContaining({
            locale: 'en',
            path: '/docs/essentials/fallback-lab',
            source: 'variant'
          }),
          expect.objectContaining({
            locale: 'de',
            path: '/de/dokumentation/essentials/fallback-lab',
            source: 'fallback',
            resolvedLocale: 'en'
          })
        ])
      },
      resolution: {
        requested: { locale: 'de' },
        resolved: { locale: 'en' },
        usedFallback: true
      }
    })
  })

  test('runs consumer-style many, navigation, surround, resolve, and populate flows', async () => {
    const { many, surround, resolveOne, navigation, one } = await import('../../packages/content/src/features/query/unified')

    await expect(many(context, posts, {
      locale: 'de',
      fallback: true,
      sort: { date: 'desc' }
    })).resolves.toEqual([
      expect.objectContaining({
        title: 'Kryptowaehrungen',
        route: expect.objectContaining({ resolvedPath: '/de/blog/kryptowaehrungen' })
      })
    ])

    await expect(navigation(context, docs, {
      locale: 'de',
      select: ['description']
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

    await expect(surround(context, docs, {
      locale: 'de',
      fallback: true,
      by: { route: '/de/dokumentation/grundlagen/markdown-syntax' },
      select: ['description']
    })).resolves.toMatchObject({
      previous: { title: 'Erste Schritte' },
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
          route: expect.objectContaining({ resolvedPath: '/de/autoren/emily' })
        })
      ])
    })
  })
})
