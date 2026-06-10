import { describe, expect, test } from 'vitest'

import { applyContentRuntimeConfig } from '../../packages/content/src/module/runtime-config'
import { contentModuleDefaults } from '../../packages/content/src/module/defaults'
import { defaultMiniSearchOptions } from '../../packages/content/src/module/options'

const createOptions = () => ({
  api: { baseURL: '/api/_content' },
  links: {},
  experimental: { stripQueryParameters: false },
  contentHead: true,
  respectPathCase: false
})

const createContentContext = () => ({
  locales: ['en', 'de'],
  defaultLocale: 'en',
  links: {},
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
  test('uses the shared MiniSearch defaults as the module default source of truth', () => {
    expect(contentModuleDefaults.search.minisearch).toEqual({
      fields: [...defaultMiniSearchOptions.fields],
      storeFields: [...defaultMiniSearchOptions.storeFields],
      boost: { ...defaultMiniSearchOptions.boost },
      fuzzy: defaultMiniSearchOptions.fuzzy,
      prefix: defaultMiniSearchOptions.prefix
    })
  })

  test('exposes Nuxt site.url as runtimeConfig.public.content.siteUrl for runtime content features', () => {
    const nuxt = createNuxt({ url: 'https://docs.example.test' })

    applyContentRuntimeConfig(
      nuxt as any,
      createOptions() as any,
      createContentContext() as any,
      { docs: { source: '1.docs/**/*', strict: false, sitemap: true } },
      1,
      'cache-integrity'
    )

    expect(nuxt.options.runtimeConfig.public.content.siteUrl).toBe('https://docs.example.test')
    expect(nuxt.options.runtimeConfig.public.siteUrl).toBeUndefined()
  })

  test('uses explicit runtimeConfig.public.siteUrl as legacy input without writing a global output key', () => {
    const nuxt = createNuxt({ url: 'https://site-config.example.test' }, 'https://runtime.example.test')

    applyContentRuntimeConfig(
      nuxt as any,
      createOptions() as any,
      createContentContext() as any,
      { docs: { source: '1.docs/**/*', strict: false, sitemap: true } },
      1,
      'cache-integrity'
    )

    expect(nuxt.options.runtimeConfig.public.content.siteUrl).toBe('https://runtime.example.test')
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

  test('publishes configured markdown quick links to public runtime config', () => {
    const nuxt = createNuxt()
    const context = {
      ...createContentContext(),
      links: {
        main: {
          pricing: { route: 'pricing' }
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

    expect(nuxt.options.runtimeConfig.public.content.links).toEqual({
      main: {
        pricing: { route: 'pricing' }
      }
    })
  })

  test('publishes finalized markdown quick links from content context', () => {
    const nuxt = createNuxt()
    const options = {
      ...createOptions(),
      links: {
        main: {
          stale: { route: 'stale' }
        }
      }
    }
    const context = {
      ...createContentContext(),
      links: {
        main: {
          services: { route: 'services' }
        }
      }
    }

    applyContentRuntimeConfig(
      nuxt as any,
      options as any,
      context as any,
      { docs: { source: '1.docs/**/*', strict: false, sitemap: true } },
      1,
      'cache-integrity'
    )

    expect(nuxt.options.runtimeConfig.public.content.links).toEqual({
      main: {
        services: { route: 'services' }
      }
    })
    expect(nuxt.options.runtimeConfig.public.content.links.main.stale).toBeUndefined()
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
