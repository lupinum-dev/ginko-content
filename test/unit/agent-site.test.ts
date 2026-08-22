import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  markdownBody,
  providerDocumentFor,
  providerListResponse
} from './_agent-fixture'

describe('agent site index', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('__ginkoTestRuntimeConfig', {
      content: {
        siteUrl: 'https://example.test',
        defaultLocale: 'en',
        collections: {
          docs: {
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
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('does not render markdown bodies while building the agent page index', async () => {
    const query = vi.fn(async (_event, providerQuery) => providerListResponse(providerQuery, [
      providerDocumentFor({
        path: '/docs/intro',
        title: 'Intro',
        description: 'Start here.',
        body: markdownBody([
          { type: 'element', tag: 'expensive-component' }
        ])
      })
    ]))

    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        siteUrl: 'https://example.test',
        defaultLocale: 'en',
        locales: ['en'],
        agent: {
          site: {
            title: 'Docs',
            description: 'Docs site.',
            whenToUse: 'Use this site for Docs.'
          },
          sections: [{ id: 'docs', title: 'Docs', order: 10 }]
        },
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { section: 'docs', markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({ query })
    }))

    const { clearAgentMarkdownSerializers, registerAgentMarkdownSerializer } = await import('../../packages/content/src/runtime/server/agent-markdown')
    const { buildAgentPageIndex, renderLlmsTxt } = await import('../../packages/content/src/runtime/server/agent-site')
    const serializer = vi.fn(() => 'rendered')

    clearAgentMarkdownSerializers()
    registerAgentMarkdownSerializer('expensive-component', serializer)

    const pages = await buildAgentPageIndex({ node: { req: { headers: {} } } } as any)

    expect(pages).toHaveLength(1)
    expect(pages[0]).toMatchObject({
      path: '/docs/intro',
      rawPath: '/raw/docs/intro.md',
      markdownPath: '/docs/intro/index.md',
      markdownUrl: 'https://example.test/raw/docs/intro.md'
    })
    expect(renderLlmsTxt(pages)).toContain('## When to use\n\nUse this site for Docs.')
    expect(serializer).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      plan: expect.objectContaining({
        projection: expect.objectContaining({ only: expect.not.arrayContaining(['body']) })
      })
    }))
  })

  test('collects only raw markdown and llms prerender routes', async () => {
    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        siteUrl: 'https://example.test',
        defaultLocale: 'en',
        locales: ['en'],
        agent: {
          site: {
            title: 'Docs',
            description: 'Docs site.',
            whenToUse: 'Use this site for Docs.'
          },
          sections: [{ id: 'docs', title: 'Docs', order: 10 }]
        },
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { section: 'docs', markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({
        query: async (_event: unknown, providerQuery: any) => providerListResponse(providerQuery, [
          providerDocumentFor({
            path: '/docs/intro',
            file: { path: 'content/docs/intro.md' },
            title: 'Intro'
          })
        ])
      })
    }))

    const { collectAgentMarkdownPrerenderRoutes } = await import('../../packages/content/src/runtime/server/agent-site')

    await expect(collectAgentMarkdownPrerenderRoutes({ node: { req: { headers: {} } } } as any)).resolves.toEqual([
      '/raw/docs/intro.md',
      '/llms.txt',
      '/llms-full.txt'
    ])
  })

  test('uses the source-locale public route for localized fallback agent pages', async () => {
    vi.stubGlobal('__ginkoTestRuntimeConfig', {
      content: {
        siteUrl: 'https://example.test',
        defaultLocale: 'en',
        locales: ['en', 'de'],
        localeFallback: { de: ['en'] },
        collections: {
          docs: {
            i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
            route: { en: '/guide', de: '/leitfaden' },
            localePolicy: {
              localized: true,
              locales: ['en', 'de'],
              defaultLocale: 'en',
              fallback: { de: ['en'] },
              translatedSlugs: false,
              routeMounts: { en: '/guide', de: '/leitfaden' }
            }
          }
        }
      }
    })
    const query = vi.fn(async (_event, params) => {
      expect(params).toEqual(expect.objectContaining({
        v: 4,
        plan: expect.objectContaining({
          resolveLocale: expect.objectContaining({ locale: 'de' }),
          projection: expect.objectContaining({
            only: expect.arrayContaining(['file', 'title', 'description'])
          })
        })
      }))

      return providerListResponse(params, [
        providerDocumentFor({
          path: '/guide/advanced',
          locale: 'en',
          file: { path: 'en/1.guide/2.advanced.md' },
          title: 'Advanced'
        })
      ])
    })

    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        siteUrl: 'https://example.test',
        defaultLocale: 'en',
        locales: ['en', 'de'],
        agent: {
          site: {
            title: 'Docs',
            description: 'Docs site.',
            whenToUse: 'Use this site for Docs.'
          },
          sections: [{ id: 'docs', title: { en: 'Docs', de: 'Dokumentation' }, order: 10 }]
        },
        collections: {
          docs: {
            type: 'page',
            route: {
              en: '/guide',
              de: '/leitfaden'
            },
            i18n: {
              defaultLocale: 'en',
              locales: ['en', 'de']
            },
            agent: { section: 'docs', markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({ query })
    }))

    const { buildAgentPageIndex } = await import('../../packages/content/src/runtime/server/agent-site')

    await expect(buildAgentPageIndex({ node: { req: { headers: {} } } } as any, 'de')).resolves.toEqual([
      expect.objectContaining({
        path: '/guide/advanced',
        rawPath: '/raw/guide/advanced.md',
        markdownPath: '/guide/advanced/index.md',
        locale: 'en'
      })
    ])
  })

  test('fails clearly when app-owned and content-owned agent pages share a route', async () => {
    vi.doMock('../../packages/content/src/runtime/server/storage-access', () => ({
      contentConfig: () => ({
        siteUrl: 'https://example.test',
        defaultLocale: 'en',
        locales: ['en'],
        agent: {
          site: {
            title: 'Docs',
            description: 'Docs site.',
            whenToUse: 'Use this site for Docs.'
          },
          pages: [
            {
              id: 'intro',
              route: '/docs/intro',
              section: 'docs',
              title: 'App Intro',
              description: 'App intro.',
              render: () => '# App Intro'
            }
          ],
          sections: [{ id: 'docs', title: 'Docs', order: 10 }]
        },
        collections: {
          docs: {
            type: 'page',
            route: '/docs',
            agent: { section: 'docs', markdown: true }
          }
        }
      })
    }))
    vi.doMock('../../packages/content/src/runtime/server/providers', () => ({
      getContentProvider: async () => ({
        query: async (_event: unknown, providerQuery: any) => providerListResponse(providerQuery, [
          providerDocumentFor({
            path: '/docs/intro',
            title: 'Content Intro',
            description: 'Content intro.'
          })
        ])
      })
    }))

    const { buildAgentPageIndex } = await import('../../packages/content/src/runtime/server/agent-site')

    await expect(buildAgentPageIndex({ node: { req: { headers: {} } } } as any)).rejects.toThrow(
      /Duplicate agent route "\/docs\/intro"/
    )
  })
})
