import { describe, expect, test } from 'vitest'

import { applyContentRuntimeConfig } from '../../packages/content/src/module/runtime-config'
import { contentModuleDefaults } from '../../packages/content/src/module/defaults'
import { createPortabilityContractFixture } from '../../packages/content/src/testing/portability-contract'

const createOptions = () => ({
  api: { baseURL: '/api/_content' },
  links: {},
  respectPathCase: false
})

const createContentContext = () => ({
  locales: ['en', 'de'],
  defaultLocale: 'en',
  localePolicy: {
    defaultLocale: 'en',
    locales: ['en', 'de'],
    fallback: {},
    collections: {}
  },
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
  navigation: { fields: [] },
  collections: {},
  contract: createPortabilityContractFixture()
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
    Object.fromEntries(Object.entries(context.contract.collections).map(([id, collection]) => [id, collection.componentPolicy])),
    collections,
    privateCollections,
    1,
    'cache-integrity'
  )
}

describe('runtime config contracts', () => {
  test('publishes cache format version 4 after canonical Markdown normalization changed', async () => {
    const nuxt = createNuxt()

    await applyRuntimeConfig(nuxt, createOptions(), createContentContext())

    expect((nuxt.options.runtimeConfig.content as { cacheVersion?: number }).cacheVersion).toBe(4)
  })

  test('keeps search disabled until an application opts in', () => {
    expect(contentModuleDefaults.search).toBe(false)
  })

  test('keeps the resolved Nuxt site URL private for server runtime features', async () => {
    const nuxt = createNuxt({ url: 'https://docs.example.test' })

    await applyRuntimeConfig(nuxt, createOptions(), createContentContext())

    expect(nuxt.options.runtimeConfig.content.siteUrl).toBe('https://docs.example.test')
    expect(nuxt.options.runtimeConfig.public.content.siteUrl).toBeUndefined()
    expect(nuxt.options.runtimeConfig.public.siteUrl).toBeUndefined()
  })

  test('accepts explicit runtimeConfig.public.siteUrl as legacy input without copying it into the content payload', async () => {
    const nuxt = createNuxt(
      { url: 'https://site-config.example.test' },
      'https://runtime.example.test'
    )

    await applyRuntimeConfig(nuxt, createOptions(), createContentContext())

    expect(nuxt.options.runtimeConfig.content.siteUrl).toBe('https://runtime.example.test')
    expect(nuxt.options.runtimeConfig.public.content.siteUrl).toBeUndefined()
    expect(nuxt.options.runtimeConfig.public.siteUrl).toBe('https://runtime.example.test')
  })

  test('publishes only the exact client contract and keeps collection internals private', async () => {
    const nuxt = createNuxt()
    const localePolicy = {
      localized: false,
      locales: [],
      defaultLocale: 'en',
      fallback: {},
      translatedSlugs: false,
      routeMounts: { en: '/' }
    }
    const collection = {
      source: 'private/**/*.md',
      exclude: ['private/drafts/**'],
      type: 'page',
      strict: true,
      localePolicy,
      sitemap: true,
      route: '/docs',
      cms: { adapter: 'private-cms', settings: { token: 'server-only' } },
      agent: { section: 'private-agent' },
      references: { authors: ['author'] },
      schemaFields: ['title', 'author']
    }

    await applyRuntimeConfig(nuxt, createOptions(), createContentContext(), {}, { docs: collection }, { docs: collection })

    expect(Object.keys(nuxt.options.runtimeConfig.public.content).sort()).toEqual([
      'api',
      'collections',
      'defaultLocale',
      'integrity',
      'links',
      'locales',
      'markdown',
      'renderPolicies',
      'search'
    ])
    expect(nuxt.options.runtimeConfig.public.content.collections.docs).toEqual({
      localePolicy,
      references: { authors: ['author'] }
    })
    expect(JSON.stringify(nuxt.options.runtimeConfig.public.content)).not.toMatch(
      /private\/\*\*|private-cms|server-only|private-agent|schemaFields|providers|sitemap|navigation/
    )
    expect(nuxt.options.runtimeConfig.content.collections.docs).toEqual(collection)
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
        storeFields: ['path', 'title', 'excerpt', 'collection', 'tags'],
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

  test('keeps parser descriptors private and serializable', async () => {
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
            name: 'shiki',
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

    expect((nuxt.options.runtimeConfig.public.content.markdown as Record<string, unknown>).plugins).toBeUndefined()
    expect(nuxt.options.runtimeConfig.content.markdown.plugins[0].options.transformers).toEqual([
      { name: '@shikijs/transformers:notation-highlight' }
    ])
    expect(JSON.stringify(nuxt.options.runtimeConfig.content)).not.toContain('line')
  })

  test('keeps revalidation token in private runtime config only', async () => {
    const nuxt = createNuxt()

    await applyRuntimeConfig(
      nuxt,
      { ...createOptions(), revalidate: { token: 'secret' } } as any,
      createContentContext()
    )

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

    await applyRuntimeConfig(nuxt, createOptions(), createContentContext(), {
      agent: {
        site: {
          title: 'Docs',
          description: 'Docs site'
        },
        pages: [
          {
            id: 'home',
            route: { en: '/', de: '/de' },
            section: 'business',
            title: ({ locale }: { locale: string }) => (locale === 'de' ? 'Startseite' : 'Home'),
            description: ({ locale }: { locale: string }) =>
              locale === 'de' ? 'Deutsche Startseite' : 'English home',
            render: ({ locale }: { locale: string }) =>
              `# ${locale === 'de' ? 'Startseite' : 'Home'}`
          }
        ]
      }
    })

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
