import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { collectSitemapCollectionRouteCounts, registerContentNitroIntegrationHooks } from '../../packages/content/src/module/integration-hooks'

const createContentRoot = async (files: Record<string, string>) => {
  const root = await mkdtemp(join(tmpdir(), 'content-integration-hooks-'))

  for (const [file, contents] of Object.entries(files)) {
    const target = join(root, file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, contents, 'utf8')
  }

  return root
}

describe('integration hook contracts', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  test('counts localized sitemap routes per collection from content-style ids', async () => {
    const root = await createContentRoot({
      'content/en/1.docs/1.getting-started/1.index.md': '# English docs',
      'content/de/1.dokumentation/1.einstieg/1.index.md': '# Deutsche docs',
      'content/en/3.blog/1.launch-metrics.md': '# English post',
      'content/de/3.magazin/1.launch-metriken.md': '# Deutscher post'
    })
    tempDirs.push(root)

    const counts = await collectSitemapCollectionRouteCounts(root, {
      collections: {
        docs: { source: '1.*/*/*.md' } as any,
        posts: { source: '3.*/*.md' } as any
      },
      locales: ['en', 'de'],
      defaultLocale: 'en',
      translatedSlugs: true,
      respectPathCase: false,
      markdown: {
        plugins: [],
        tags: {},
        anchorLinks: { depth: 4, exclude: [1] }
      },
      yaml: {},
      csv: { delimiter: ',', json: true },
      sitemap: {
        path: '/sitemap',
        include: ['docs', 'posts'],
        exclude: [],
        includeDrafts: false,
        assert: {
          enabled: true,
          mode: 'generate',
          allowEmpty: false,
          minUrlsPerSitemap: 1,
          requireImages: false,
          requiredCollections: ['docs', 'posts'],
          sitemaps: {}
        }
      }
    })

    expect(counts).toEqual({
      docs: 1,
      posts: 1
    })
  })

  test('supports array collection sources without double-counting localized routes', async () => {
    const root = await createContentRoot({
      'content/en/1.docs/1.getting-started/1.index.md': '# English docs',
      'content/de/1.dokumentation/1.einstieg/1.index.md': '# Deutsche docs',
      'content/en/1.docs/2.reference/1.index.yml': 'title: Reference',
      'content/de/1.dokumentation/2.referenz/1.index.yml': 'title: Referenz'
    })
    tempDirs.push(root)

    const counts = await collectSitemapCollectionRouteCounts(root, {
      collections: {
        docs: { source: ['1.*/*/*.md', '1.*/*/*.yml', '1.*/*/*.md'] } as any
      },
      locales: ['en', 'de'],
      defaultLocale: 'en',
      translatedSlugs: true,
      respectPathCase: false,
      markdown: {
        plugins: [],
        tags: {},
        anchorLinks: { depth: 4, exclude: [1] }
      },
      yaml: {},
      csv: { delimiter: ',', json: true },
      sitemap: {
        path: '/sitemap',
        include: ['docs'],
        exclude: [],
        includeDrafts: false,
        assert: {
          enabled: true,
          mode: 'generate',
          allowEmpty: false,
          minUrlsPerSitemap: 1,
          requireImages: false,
          requiredCollections: ['docs'],
          sitemaps: {}
        }
      }
    })

    expect(counts).toEqual({
      docs: 2
    })
  })

  test('registers prerender routes for array-based collection sources', async () => {
    const root = await createContentRoot({
      'content/en/1.docs/1.getting-started/1.index.md': '# English docs',
      'content/de/1.dokumentation/1.einstieg/1.index.md': '# Deutsche docs',
      'content/en/1.docs/2.reference/1.index.yml': 'title: Reference',
      'content/de/1.dokumentation/2.referenz/1.index.yml': 'title: Referenz'
    })
    tempDirs.push(root)

    const nitroConfig: Record<string, any> = {}
    registerContentNitroIntegrationHooks(nitroConfig, {
      rootDir: root,
      sitemapPrerenderRoutes: ['/sitemap_index.xml', '/__sitemap__/en-US.xml', '/__sitemap__/de-DE.xml']
    }, {
      collections: {
        docs: { source: ['1.*/*/*.md', '1.*/*/*.yml'] } as any
      },
      locales: ['en', 'de'],
      defaultLocale: 'en',
      translatedSlugs: true,
      respectPathCase: false,
      markdown: {
        plugins: [],
        tags: {},
        anchorLinks: { depth: 4, exclude: [1] }
      },
      yaml: {},
      csv: { delimiter: ',', json: true },
      sitemap: {
        path: '/sitemap',
        include: ['docs'],
        exclude: [],
        includeDrafts: false,
        assert: {
          enabled: false,
          mode: 'generate',
          allowEmpty: false,
          minUrlsPerSitemap: 1,
          requireImages: false,
          requiredCollections: [],
          sitemaps: {}
        }
      }
    })

    const routes = new Set<string>()
    await nitroConfig.hooks['prerender:routes'](routes)

    expect([...routes].sort()).toEqual([
      '/__sitemap__/de-DE.xml',
      '/__sitemap__/en-US.xml',
      '/de/dokumentation/einstieg',
      '/de/dokumentation/referenz',
      '/docs/getting-started',
      '/docs/reference',
      '/sitemap_index.xml'
    ])
  })

  test('registers translated slug prerender routes from canonical numeric collection sources', async () => {
    const root = await createContentRoot({
      'content/en/1.docs/1.getting-started/1.index.md': '# English docs',
      'content/de/1.dokumentation/1.einstieg/1.index.md': '# Deutsche docs',
      'content/en/2.pricing.yml': 'title: Pricing',
      'content/de/2.preise.yml': 'title: Preise'
    })
    tempDirs.push(root)

    const nitroConfig: Record<string, any> = {}
    registerContentNitroIntegrationHooks(nitroConfig, { rootDir: root }, {
      collections: {
        docs: { source: '1.docs/**/*' } as any,
        pricing: { source: '2.pricing.yml' } as any
      },
      locales: ['en', 'de'],
      defaultLocale: 'en',
      translatedSlugs: true,
      respectPathCase: false,
      markdown: {
        plugins: [],
        tags: {},
        anchorLinks: { depth: 4, exclude: [1] }
      },
      yaml: {},
      csv: { delimiter: ',', json: true },
      sitemap: {
        path: '/sitemap',
        include: ['docs', 'pricing'],
        exclude: [],
        includeDrafts: false,
        assert: {
          enabled: false,
          mode: 'generate',
          allowEmpty: false,
          minUrlsPerSitemap: 1,
          requireImages: false,
          requiredCollections: [],
          sitemaps: {}
        }
      }
    })

    const routes = new Set<string>()
    await nitroConfig.hooks['prerender:routes'](routes)

    expect([...routes].sort()).toEqual([
      '/de/dokumentation/einstieg',
      '/de/preise',
      '/docs/getting-started',
      '/pricing'
    ])
  })

  test('prerenders sitemap collections by default and honors collection opt-out', async () => {
    const root = await createContentRoot({
      'content/en/1.docs/1.getting-started.md': '# English docs',
      'content/en/2.blog/1.launch.md': '# Launch post',
      'content/en/3.internal/1.secret.md': '# Secret note'
    })
    tempDirs.push(root)

    const nitroConfig: Record<string, any> = {}
    registerContentNitroIntegrationHooks(nitroConfig, { rootDir: root }, {
      collections: {
        docs: { source: '1.*/*.md' } as any,
        posts: { source: '2.*/*.md' } as any,
        internal: { source: '3.*/*.md', sitemap: false } as any
      },
      locales: ['en'],
      defaultLocale: 'en',
      translatedSlugs: true,
      respectPathCase: false,
      markdown: {
        plugins: [],
        tags: {},
        anchorLinks: { depth: 4, exclude: [1] }
      },
      yaml: {},
      csv: { delimiter: ',', json: true },
      sitemap: {
        path: '/sitemap',
        include: undefined,
        exclude: [],
        includeDrafts: false,
        assert: {
          enabled: false,
          mode: 'generate',
          allowEmpty: false,
          minUrlsPerSitemap: 1,
          requireImages: false,
          requiredCollections: [],
          sitemaps: {}
        }
      }
    })

    const routes = new Set<string>()
    await nitroConfig.hooks['prerender:routes'](routes)

    expect([...routes].sort()).toEqual([
      '/blog/launch',
      '/docs/getting-started'
    ])
  })
})
