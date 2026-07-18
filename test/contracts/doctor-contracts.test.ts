import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { formatDoctorResult, runDoctor } from '../../packages/content/src/cli/doctor'

const createFixture = () => mkdtempSync(join(tmpdir(), 'ginko-doctor-'))

const writeFixtureFile = async (root: string, path: string, contents: string) => {
  const filePath = join(root, path)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, contents, 'utf8')
}

describe('ginko-content doctor contracts', () => {
  test('passes a clean migrated fixture', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4'
      }
    }))
    await writeFixtureFile(root, 'nuxt.config.ts', `
      export default defineNuxtConfig({
        modules: ['@lupinum/ginko-content']
      })
    `)
    await writeFixtureFile(root, 'app/pages/docs/[...slug].vue', `
      <script setup lang="ts">
      const { page } = await useContentPage('docs')
      </script>
      <template>
        <ContentRenderer v-if="page" :value="page" />
      </template>
    `)

    const result = await runDoctor({ rootDir: root })

    expect(result.exitCode).toBe(0)
    expect(result.findings).toEqual([])
  })

  test('reports removed public Ginko query APIs', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4'
      }
    }))
    await writeFixtureFile(root, 'pages/docs/[...slug].vue', `
      <script setup lang="ts">
      const { page } = await useContentPage('docs')
      const { items } = await useContentList('docs')
      const raw = await queryCollection('docs').all()
      </script>
    `)

    const result = await runDoctor({ rootDir: root })

    expect(result.exitCode).toBe(1)
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        message: 'Removed content list composable found.'
      }),
      expect.objectContaining({
        severity: 'error',
        message: 'Removed collection query helper found.'
      })
    ]))
  })

  test('reports removed v3 runtime config keys but treats content.preview as an informational reminder, not a v3 leftover', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4'
      }
    }))
    await writeFixtureFile(root, 'nuxt.config.ts', `
      export default defineNuxtConfig({
        modules: ['@lupinum/ginko-content']
      })
    `)
    await writeFixtureFile(root, 'server/utils/leftover-v3-config.ts', `
      import { useRuntimeConfig } from '#imports'

      const config = useRuntimeConfig()
      // Leftover v3 assumptions: config.content.database, config.content.build
      // Ginko's own option, still valid: config.content.preview
      export const usesLegacyDatabase = Boolean(config.content.database)
      export const usesLegacyBuild = Boolean(config.content.build)
      export const usesPreview = Boolean(config.content.preview)
    `)

    const result = await runDoctor({ rootDir: root })

    expect(result.exitCode).toBe(1)
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        message: 'Nuxt Content v3 runtime config key found.'
      }),
      expect.objectContaining({
        severity: 'info',
        message: 'content.preview configuration found.',
        suggestion: expect.stringContaining('authenticated filesystem preview is unsupported in production')
      })
    ]))
    expect(result.findings).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'content.preview configuration found.', severity: 'error' })
    ]))
  })

  test('accepts route-safe navigation and list path links', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4'
      }
    }))
    await writeFixtureFile(root, 'app/components/DocsNav.vue', `
      <script setup lang="ts">
      const { data: navigation } = await useContentNavigation('docs')
      const { data: posts } = await useContentMany('blog')
      </script>
      <template>
        <NuxtLink v-for="item in navigation" :key="item.path" :to="item.path">
          {{ item.title }}
        </NuxtLink>
        <NuxtLink v-for="post in posts" :key="post.path" :to="post.path">
          {{ post.title }}
        </NuxtLink>
      </template>
    `)

    const result = await runDoctor({ rootDir: root })

    expect(result.exitCode).toBe(0)
    expect(result.findings).toEqual([])
  })

  test('fails on direct Nuxt Content dependency and module usage', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@nuxt/content': '^3.13.0'
      }
    }))
    await writeFixtureFile(root, 'nuxt.config.ts', `
      export default defineNuxtConfig({
        modules: ['@nuxt/content']
      })
    `)

    const result = await runDoctor({ rootDir: root })

    expect(result.exitCode).toBe(1)
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        file: 'package.json',
        message: 'Direct dependency "@nuxt/content" found in dependencies.'
      }),
      expect.objectContaining({
        severity: 'error',
        file: 'nuxt.config.ts',
        message: 'Nuxt Content module or package reference found.'
      })
    ]))
  })

  test('reports Studio editor helpers and body-only rendering', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4'
      }
    }))
    await writeFixtureFile(root, 'content.config.ts', `
      image: z.string().editor({ input: 'media' })
    `)
    await writeFixtureFile(root, 'pages/docs/[...slug].vue', `
      <template>
        <ContentRenderer :value="page.body" />
      </template>
    `)

    const result = await runDoctor({ rootDir: root })

    expect(result.exitCode).toBe(1)
    expect(formatDoctorResult(result)).toContain('Remove .editor(...) from runtime Zod schemas')
    expect(formatDoctorResult(result)).toContain('Pass the full content document to ContentRenderer')
  })

  test('keeps lockfile-only Nuxt Content references informational', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4'
      }
    }))
    await writeFixtureFile(root, 'pnpm-lock.yaml', `
      packages:
        '@nuxt/content@3.13.0': {}
        'better-sqlite3@12.9.0': {}
    `)

    const result = await runDoctor({ rootDir: root })

    expect(result.exitCode).toBe(0)
    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: 'info',
        file: 'pnpm-lock.yaml',
        message: 'Lockfile still mentions @nuxt/content, better-sqlite3.'
      })
    ])
  })

  test('warns when static public search explicitly indexes data collections', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4'
      }
    }))
    await writeFixtureFile(root, 'nuxt.config.ts', `
      export default defineNuxtConfig({
        modules: ['@lupinum/ginko-content'],
        content: {
          search: {
            collections: ['docs', 'authors']
          }
        }
      })
    `)
    await writeFixtureFile(root, 'content.config.ts', `
      import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

      export const docs = defineCollection({
        type: 'page',
        source: 'docs/**/*.md',
        route: '/docs'
      })

      export const authors = defineCollection({
        type: 'data',
        source: 'authors/**/*.yml'
      })

      export default defineContentConfig({
        collections: { docs, authors }
      })
    `)

    const result = await runDoctor({ rootDir: root })

    expect(result.exitCode).toBe(0)
    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: 'info',
        file: 'nuxt.config.ts',
        message: 'Data-only collections listed in content.search.collections: authors.'
      })
    ])
  })

  test('accepts Nuxt Sitemap index output when sitemap.xml is a directory', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4'
      }
    }))
    await writeFixtureFile(root, '.output/public/sitemap.xml/index.html', `
      <!doctype html>
      <meta http-equiv="refresh" content="0; url=/sitemap_index.xml">
    `)
    await writeFixtureFile(root, '.output/public/sitemap_index.xml', `
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/__sitemap__/en-US.xml</loc></sitemap>
      </sitemapindex>
    `)
    await writeFixtureFile(root, '.output/public/__sitemap__/en-US.xml', `
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/docs/getting-started</loc></url>
      </urlset>
    `)

    const result = await runDoctor({ rootDir: root })

    expect(result.exitCode).toBe(0)
    expect(result.findings).toEqual([])
  })

  test('passes a complete i18n migrated fixture', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4',
        '@nuxtjs/i18n': '^10.3.0'
      }
    }))
    await writeFixtureFile(root, 'nuxt.config.ts', `
      export default defineNuxtConfig({
        modules: ['@nuxtjs/i18n', '@lupinum/ginko-content'],
        i18n: {
          defaultLocale: 'en',
          locales: [
            { code: 'en', language: 'en-US' },
            { code: 'de', language: 'de-DE' }
          ]
        },
        content: {
          i18n: {
            fallback: {
              de: ['en']
            }
          }
        }
      })
    `)
    await writeFixtureFile(root, 'content.config.ts', `
      import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

      export default defineContentConfig({
        collections: {
          docs: defineCollection({
            type: 'page',
            source: 'docs/**/*.md',
            i18n: true
          }),
          posts: defineCollection({
            type: 'page',
            source: 'posts/**/*.md',
            i18n: true
          })
        }
      })
    `)
    await writeFixtureFile(root, 'content/en/docs/index.md', '# Docs')
    await writeFixtureFile(root, 'content/de/docs/index.md', '# Dokumentation')
    await writeFixtureFile(root, '.output/public/sitemap.xml/index.html', `
      <!doctype html>
      <meta http-equiv="refresh" content="0; url=/sitemap_index.xml">
    `)
    await writeFixtureFile(root, '.output/public/sitemap_index.xml', `
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/__sitemap__/en-US.xml</loc></sitemap>
        <sitemap><loc>https://example.com/__sitemap__/de-DE.xml</loc></sitemap>
      </sitemapindex>
    `)
    await writeFixtureFile(root, '.output/public/__sitemap__/en-US.xml', `
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/docs</loc></url>
      </urlset>
    `)
    await writeFixtureFile(root, '.output/public/__sitemap__/de-DE.xml', `
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/de/docs</loc></url>
      </urlset>
    `)
    await writeFixtureFile(root, '.output/public/api/_content/search/index.json', JSON.stringify([
      { locale: 'en', path: '/docs', title: 'Docs' },
      { locale: 'de', path: '/de/docs', title: 'Dokumentation' }
    ]))

    const result = await runDoctor({ rootDir: root, i18n: true })
    const output = formatDoctorResult(result)

    expect(result.exitCode).toBe(0)
    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: 'info',
        file: '.output/public/sitemap_index.xml',
        message: 'Sitemap mode: Nuxt Sitemap i18n multi-sitemap (2 child sitemaps, 2 URLs).'
      })
    ])
    expect(output).toContain('Submit "/sitemap_index.xml"')
    expect(output).toContain('__sitemap__/de-DE.xml (1 URL)')
    expect(output).toContain('Ignore .output/public/sitemap.xml/')
  })

  test('rejects duplicate locale authority when Nuxt I18n is registered', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4',
        '@nuxtjs/i18n': '^10.3.0'
      }
    }))
    await writeFixtureFile(root, 'nuxt.config.ts', `
      export default defineNuxtConfig({
        modules: ['@nuxtjs/i18n', '@lupinum/ginko-content'],
        i18n: {
          defaultLocale: 'en',
          locales: ['en', 'de']
        },
        content: {
          i18n: {
            defaultLocale: 'en',
            locales: ['en', 'de']
          }
        }
      })
    `)
    await writeFixtureFile(root, 'content.config.ts', `
      export default defineContentConfig({ collections: {} })
    `)
    await writeFixtureFile(root, 'content/en/index.md', '# Home')
    await writeFixtureFile(root, 'content/de/index.md', '# Startseite')

    const result = await runDoctor({ rootDir: root, i18n: true })

    expect(result.exitCode).toBe(1)
    expect(result.findings).toEqual([
      expect.objectContaining({
        severity: 'error',
        file: 'nuxt.config.ts',
        message: 'Duplicate locale authority found in content.i18n.'
      })
    ])
  })

  test('accepts content-owned locale authority without Nuxt I18n', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4'
      }
    }))
    await writeFixtureFile(root, 'nuxt.config.ts', `
      export default defineNuxtConfig({
        modules: ['@lupinum/ginko-content'],
        content: {
          i18n: {
            defaultLocale: 'en',
            locales: ['en', 'de']
          }
        }
      })
    `)
    await writeFixtureFile(root, 'content.config.ts', `
      import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

      export default defineContentConfig({
        collections: {
          docs: defineCollection({
            type: 'page',
            source: 'docs/**/*.md',
            i18n: true
          })
        }
      })
    `)
    await writeFixtureFile(root, 'content/en/docs/index.md', '# Docs')
    await writeFixtureFile(root, 'content/de/docs/index.md', '# Dokumentation')

    const result = await runDoctor({ rootDir: root, i18n: true })

    expect(result.exitCode).toBe(0)
    expect(result.findings).toEqual([])
  })

  test('i18n mode reports collections and locale folders that are not wired for localization', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4',
        '@nuxtjs/i18n': '^10.3.0'
      }
    }))
    await writeFixtureFile(root, 'nuxt.config.ts', `
      export default defineNuxtConfig({
        modules: ['@nuxtjs/i18n', '@lupinum/ginko-content'],
        i18n: {
          defaultLocale: 'en',
          locales: ['en', 'de']
        }
      })
    `)
    await writeFixtureFile(root, 'content.config.ts', `
      import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

      export const docs = defineCollection({
        type: 'page',
        source: 'docs/**/*.md'
      })

      export default defineContentConfig({
        collections: { docs }
      })
    `)
    await writeFixtureFile(root, 'content/en/docs/index.md', '# Docs')

    const result = await runDoctor({ rootDir: root, i18n: true })
    const output = formatDoctorResult(result)

    expect(result.exitCode).toBe(1)
    expect(output).toContain('Collection "docs" is not marked as i18n-aware.')
    expect(output).toContain('Content locale folder "de" is missing.')
  })

  test('i18n mode checks collections declared through map-key identity', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4',
        '@nuxtjs/i18n': '^10.3.0'
      }
    }))
    await writeFixtureFile(root, 'nuxt.config.ts', `
      export default defineNuxtConfig({
        modules: ['@nuxtjs/i18n', '@lupinum/ginko-content'],
        i18n: {
          defaultLocale: 'en',
          locales: ['en', 'de']
        }
      })
    `)
    await writeFixtureFile(root, 'content.config.ts', `
      import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

      export const docs = defineCollection({
        type: 'page',
        source: 'docs/**/*.md'
      })

      export default defineContentConfig({
        collections: {
          docs
        }
      })
    `)
    await writeFixtureFile(root, 'content/en/docs/index.md', '# Docs')
    await writeFixtureFile(root, 'content/de/docs/index.md', '# Dokumentation')

    const result = await runDoctor({ rootDir: root, i18n: true })
    const output = formatDoctorResult(result)

    expect(result.exitCode).toBe(1)
    expect(output).toContain('Collection "docs" is not marked as i18n-aware.')
    expect(output).not.toContain('Content locale folder "de" is missing.')
  })

  test('i18n mode reports repeated locale output and missing locale search records', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4',
        '@nuxtjs/i18n': '^10.3.0'
      }
    }))
    await writeFixtureFile(root, 'nuxt.config.ts', `
      export default defineNuxtConfig({
        modules: ['@nuxtjs/i18n', '@lupinum/ginko-content'],
        i18n: {
          defaultLocale: 'en',
          locales: ['en', 'de']
        }
      })
    `)
    await writeFixtureFile(root, 'content.config.ts', `
      import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

      export const docs = defineCollection({
        type: 'page',
        source: 'docs/**/*.md',
        i18n: true
      })

      export default defineContentConfig({
        collections: { docs }
      })
    `)
    await writeFixtureFile(root, 'content/en/docs/index.md', '# Docs')
    await writeFixtureFile(root, 'content/de/docs/index.md', '# Dokumentation')
    await writeFixtureFile(root, '.output/public/de/de/docs/index.html', '<a href="/de/de/docs">Broken</a>')
    await writeFixtureFile(root, '.output/public/sitemap_index.xml', `
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/__sitemap__/en-US.xml</loc></sitemap>
        <sitemap><loc>https://example.com/__sitemap__/de-DE.xml</loc></sitemap>
      </sitemapindex>
    `)
    await writeFixtureFile(root, '.output/public/__sitemap__/en-US.xml', '<urlset><url><loc>https://example.com/docs</loc></url></urlset>')
    await writeFixtureFile(root, '.output/public/__sitemap__/de-DE.xml', '<urlset><url><loc>https://example.com/de/docs</loc></url></urlset>')
    await writeFixtureFile(root, '.output/public/api/_content/search/index.json', JSON.stringify([
      { locale: 'en', path: '/docs', title: 'Docs' }
    ]))

    const result = await runDoctor({ rootDir: root, i18n: true })
    const output = formatDoctorResult(result)

    expect(result.exitCode).toBe(1)
    expect(output).toContain('Repeated locale prefix "/de/de/" found in generated output.')
    expect(output).toContain('Search index has no records for locale "de".')
  })

  test('i18n mode reports missing locale child sitemap', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4',
        '@nuxtjs/i18n': '^10.3.0'
      }
    }))
    await writeFixtureFile(root, 'nuxt.config.ts', `
      export default defineNuxtConfig({
        modules: ['@nuxtjs/i18n', '@lupinum/ginko-content'],
        i18n: {
          defaultLocale: 'en',
          locales: ['en', 'de']
        }
      })
    `)
    await writeFixtureFile(root, 'content.config.ts', `
      import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

      export const docs = defineCollection({
        type: 'page',
        source: 'docs/**/*.md',
        i18n: true
      })

      export default defineContentConfig({
        collections: { docs }
      })
    `)
    await writeFixtureFile(root, 'content/en/docs/index.md', '# Docs')
    await writeFixtureFile(root, 'content/de/docs/index.md', '# Dokumentation')
    await writeFixtureFile(root, '.output/public/sitemap_index.xml', `
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/__sitemap__/en-US.xml</loc></sitemap>
      </sitemapindex>
    `)
    await writeFixtureFile(root, '.output/public/__sitemap__/en-US.xml', '<urlset><url><loc>https://example.com/docs</loc></url></urlset>')

    const result = await runDoctor({ rootDir: root, i18n: true })
    const output = formatDoctorResult(result)

    expect(result.exitCode).toBe(1)
    expect(output).toContain('Generated sitemap is missing non-empty locale sitemap for "de".')
  })

  test('i18n mode reports hardcoded locale routes, raw _path links, and duplicate translated groups', async () => {
    const root = createFixture()
    await writeFixtureFile(root, 'package.json', JSON.stringify({
      dependencies: {
        '@lupinum/ginko-content': '^2.13.4',
        '@nuxtjs/i18n': '^10.3.0'
      }
    }))
    await writeFixtureFile(root, 'nuxt.config.ts', `
      export default defineNuxtConfig({
        modules: ['@nuxtjs/i18n', '@lupinum/ginko-content'],
        i18n: {
          defaultLocale: 'en',
          locales: ['en', 'de']
        }
      })
    `)
    await writeFixtureFile(root, 'content.config.ts', `
      import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

      export const posts = defineCollection({
        type: 'page',
        source: 'posts/**/*.md',
        i18n: true
      })

      export default defineContentConfig({
        collections: { posts }
      })
    `)
    await writeFixtureFile(root, 'content/en/1.posts/index.md', '# Posts')
    await writeFixtureFile(root, 'content/de/1.posts/index.md', '# Posts')
    await writeFixtureFile(root, 'content/de/1.beitraege/index.md', '# Beitraege')
    await writeFixtureFile(root, 'app/components/AppHeader.vue', `
      <script setup lang="ts">
      const { locale } = useI18n()
      const docsPath = computed(() => locale.value === 'de' ? '/de/dokumentation' : '/docs')
      </script>
      <template>
        <UBlogPost :to="post._path" />
      </template>
    `)

    const result = await runDoctor({ rootDir: root, i18n: true })
    const output = formatDoctorResult(result)

    expect(result.exitCode).toBe(1)
    expect(output).toContain('Hardcoded locale route branch found.')
    expect(output).toContain('UI link is bound to raw content _path.')
    expect(output).toContain('multiple content groups with ordinal "1"')
  })
})
