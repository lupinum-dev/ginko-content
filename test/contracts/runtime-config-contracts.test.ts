import { describe, expect, test } from 'vitest'

import { applyContentRuntimeConfig } from '../../packages/content/src/module/runtime-config'
import { contentModuleDefaults } from '../../packages/content/src/module/defaults'
import { defaultMiniSearchOptions } from '../../packages/content/src/module/options'

const createOptions = () => ({
  api: { baseURL: '/api/_content' },
  links: {},
  experimental: { stripQueryParameters: false },
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

const runtimeCollections = { docs: { source: '1.docs/**/*', strict: false, sitemap: true } }

const applyRuntimeConfig = async (
  nuxt: ReturnType<typeof createNuxt>,
  options: ReturnType<typeof createOptions>,
  context: ReturnType<typeof createContentContext>,
  appContentConfig: Record<string, any> = {},
  collections: Record<string, any> = runtimeCollections,
  privateCollections: Record<string, any> = collections
) => {
  await applyContentRuntimeConfig(
    nuxt as any,
    options as any,
    context as any,
    appContentConfig as any,
    collections,
    privateCollections,
    1,
    'cache-integrity'
  )
}

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

  test('exposes Nuxt site.url as runtimeConfig.public.content.siteUrl for runtime content features', async () => {
    const nuxt = createNuxt({ url: 'https://docs.example.test' })

    await applyRuntimeConfig(nuxt, createOptions(), createContentContext())

    expect(nuxt.options.runtimeConfig.public.content.siteUrl).toBe('https://docs.example.test')
    expect(nuxt.options.runtimeConfig.public.siteUrl).toBeUndefined()
  })

  test('uses explicit runtimeConfig.public.siteUrl as legacy input without writing a global output key', async () => {
    const nuxt = createNuxt({ url: 'https://site-config.example.test' }, 'https://runtime.example.test')

    await applyRuntimeConfig(nuxt, createOptions(), createContentContext())

    expect(nuxt.options.runtimeConfig.public.content.siteUrl).toBe('https://runtime.example.test')
    expect(nuxt.options.runtimeConfig.public.siteUrl).toBe('https://runtime.example.test')
  })

  test('publishes markdown image and MiniSearch runtime options', async () => {
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

    await applyRuntimeConfig(nuxt, createOptions(), context as any)

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

  test('publishes configured markdown quick links to public runtime config', async () => {
    const nuxt = createNuxt()
    const context = {
      ...createContentContext(),
      links: {
        main: {
          pricing: { route: 'pricing' }
        }
      }
    }

    await applyRuntimeConfig(nuxt, createOptions(), context as any)

    expect(nuxt.options.runtimeConfig.public.content.links).toEqual({
      main: {
        pricing: { route: 'pricing' }
      }
    })
  })

  test('publishes finalized markdown quick links from content context', async () => {
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

    await applyRuntimeConfig(nuxt, options as any, context as any)

    expect(nuxt.options.runtimeConfig.public.content.links).toEqual({
      main: {
        services: { route: 'services' }
      }
    })
    expect(nuxt.options.runtimeConfig.public.content.links.main.stale).toBeUndefined()
  })

  test('keeps markdown transformer runtime config serializable', async () => {
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

    await applyRuntimeConfig(nuxt, createOptions(), context as any)

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

  test('keeps revalidation token in private runtime config only', async () => {
    const nuxt = createNuxt()

    await applyRuntimeConfig(nuxt, { ...createOptions(), revalidate: { token: 'secret' } } as any, createContentContext())

    expect(nuxt.options.runtimeConfig.public.content.revalidate).toBeUndefined()
    expect(nuxt.options.runtimeConfig.content.revalidate).toEqual({
      token: 'secret',
      allowUnsigned: false
    })
  })

  test('keeps revalidation disabled when no token is configured', async () => {
    const nuxt = createNuxt()

    await applyRuntimeConfig(nuxt, createOptions(), createContentContext())

    expect(nuxt.options.runtimeConfig.content.revalidate).toBe(false)
  })

  test('derives function-backed agent pages into serializable runtime markdown', async () => {
    const nuxt = createNuxt({ url: 'https://docs.example.test' })

    await applyRuntimeConfig(
      nuxt,
      createOptions(),
      createContentContext(),
      {
        agent: {
          site: {
            title: 'Docs',
            description: 'Docs site',
            defaultLocale: 'en',
            locales: ['en', 'de']
          },
          pages: [
            {
              id: 'home',
              route: { en: '/', de: '/de' },
              section: 'business',
              title: ({ locale }: { locale: string }) => locale === 'de' ? 'Startseite' : 'Home',
              description: ({ locale }: { locale: string }) => locale === 'de' ? 'Deutsche Startseite' : 'English home',
              render: ({ locale }: { locale: string }) => `# ${locale === 'de' ? 'Startseite' : 'Home'}`
            }
          ]
        }
      }
    )

    const page = nuxt.options.runtimeConfig.content.agent.pages[0]

    expect(page).toMatchObject({
      id: 'home',
      route: { en: '/', de: '/de' },
      title: { en: 'Home', de: 'Startseite' },
      description: { en: 'English home', de: 'Deutsche Startseite' },
      markdown: { en: '# Home', de: '# Startseite' }
    })
    expect(page.render).toBeUndefined()
    expect(JSON.stringify(nuxt.options.runtimeConfig.content.agent)).not.toContain('=>')
  })
})
