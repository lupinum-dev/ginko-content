import { describe, expect, test } from 'vitest'

import { applyContentRuntimeConfig } from '../../packages/content/src/module/runtime-config'

const createOptions = () => ({
  api: { baseURL: '/api/_content' },
  experimental: { stripQueryParameters: false },
  contentHead: true,
  respectPathCase: false
})

const createContentContext = () => ({
  locales: ['en', 'de'],
  defaultLocale: 'en',
  provider: 'filesystem',
  providers: {},
  localeFallback: {},
  translatedSlugs: true,
  strictTranslatedSlugs: false,
  markdown: {
    plugins: [],
    tags: {},
    anchorLinks: { depth: 4, exclude: [1] },
    image: 'nuxt-image'
  },
  sitemap: {
    path: '/sitemap'
  },
  search: false,
  navigation: { fields: [] }
})

const createNuxt = (site?: { url?: string }, siteUrl?: string) => ({
  options: {
    site,
    runtimeConfig: {
      public: {
        ...(siteUrl ? { siteUrl } : {})
      },
      content: {}
    }
  }
})

describe('runtime config contracts', () => {
  test('exposes Nuxt site.url as runtimeConfig.public.siteUrl for runtime content features', () => {
    const nuxt = createNuxt({ url: 'https://docs.example.test' })

    applyContentRuntimeConfig(
      nuxt as any,
      createOptions() as any,
      createContentContext() as any,
      { docs: { source: '1.docs/**/*', strict: false, sitemap: true } },
      1,
      'cache-integrity'
    )

    expect(nuxt.options.runtimeConfig.public.siteUrl).toBe('https://docs.example.test')
  })

  test('keeps an explicit runtimeConfig.public.siteUrl over Nuxt site.url', () => {
    const nuxt = createNuxt({ url: 'https://site-config.example.test' }, 'https://runtime.example.test')

    applyContentRuntimeConfig(
      nuxt as any,
      createOptions() as any,
      createContentContext() as any,
      { docs: { source: '1.docs/**/*', strict: false, sitemap: true } },
      1,
      'cache-integrity'
    )

    expect(nuxt.options.runtimeConfig.public.siteUrl).toBe('https://runtime.example.test')
  })

  test('publishes markdown image and MiniSearch runtime options', () => {
    const nuxt = createNuxt()
    const context = {
      ...createContentContext(),
      search: {
        engine: 'minisearch',
        apiBaseURL: '/search',
        ignoredTags: ['pre'],
        filterQuery: { published: true },
        extraFields: ['tags'],
        minisearch: {
          fields: ['title', 'content', 'tags'],
          storeFields: ['path', 'title', 'tags'],
          boost: { tags: 5, title: 1 },
          fuzzy: false,
          prefix: false
        }
      }
    }

    applyContentRuntimeConfig(
      nuxt as any,
      createOptions() as any,
      context as any,
      { docs: { source: '1.docs/**/*', strict: false, sitemap: true } },
      1,
      'cache-integrity'
    )

    expect(nuxt.options.runtimeConfig.public.content.markdown.image).toBe('nuxt-image')
    expect(nuxt.options.runtimeConfig.public.content.search).toMatchObject({
      apiBaseURL: '/search',
      indexURL: '/search/index.json',
      engine: 'minisearch',
      minisearch: {
        fields: ['title', 'content', 'tags'],
        storeFields: ['path', 'title', 'excerpt', 'tags'],
        boost: { tags: 5, title: 1 },
        fuzzy: false,
        prefix: false
      }
    })
  })

  test('keeps markdown transformer runtime config serializable', () => {
    const nuxt = createNuxt()
    const transformer = {
      name: '@shikijs/transformers:notation-highlight',
      line() {
        return undefined
      }
    }
    const context = {
      ...createContentContext(),
      markdown: {
        ...createContentContext().markdown,
        plugins: [
          {
            name: 'highlight',
            options: {
              preStyles: false,
              transformers: [transformer],
              themes: {
                light: { name: 'light' },
                dark: { name: 'dark' }
              }
            }
          }
        ]
      }
    }

    applyContentRuntimeConfig(
      nuxt as any,
      createOptions() as any,
      context as any,
      { docs: { source: '1.docs/**/*', strict: false, sitemap: true } },
      1,
      'cache-integrity'
    )

    expect(nuxt.options.runtimeConfig.public.content.markdown.plugins).toEqual([
      {
        name: 'highlight',
        options: {
          preStyles: false,
          themes: {
            light: { name: 'light' },
            dark: { name: 'dark' }
          }
        }
      }
    ])
    expect(nuxt.options.runtimeConfig.content.markdown.plugins[0].options.transformers).toEqual([
      { name: '@shikijs/transformers:notation-highlight' }
    ])
    expect(JSON.stringify(nuxt.options.runtimeConfig.content)).not.toContain('line')
  })

  test('keeps revalidation token in private runtime config only', () => {
    const nuxt = createNuxt()

    applyContentRuntimeConfig(
      nuxt as any,
      {
        ...createOptions(),
        revalidate: { token: 'secret' }
      } as any,
      createContentContext() as any,
      { docs: { source: '1.docs/**/*', strict: false, sitemap: true } },
      1,
      'cache-integrity'
    )

    expect(nuxt.options.runtimeConfig.public.content.revalidate).toBeUndefined()
    expect(nuxt.options.runtimeConfig.content.revalidate).toEqual({
      token: 'secret',
      allowUnsigned: false
    })
  })

  test('keeps revalidation disabled when no token is configured', () => {
    const nuxt = createNuxt()

    applyContentRuntimeConfig(
      nuxt as any,
      createOptions() as any,
      createContentContext() as any,
      { docs: { source: '1.docs/**/*', strict: false, sitemap: true } },
      1,
      'cache-integrity'
    )

    expect(nuxt.options.runtimeConfig.content.revalidate).toBe(false)
  })
})
