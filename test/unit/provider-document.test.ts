import { describe, expect, test } from 'vitest'
import {
  normalizeProviderDocument,
  shapeProviderDocument
} from '../../packages/content/src/runtime/server/provider-document'

const body = { type: 'root' as const, children: [] }

describe('provider-document normalization seam', () => {
  test('derives id, canonicalKey and type from the minimal set', () => {
    const doc = normalizeProviderDocument({
      collection: 'blog',
      locale: 'en',
      path: '/blog/hello-world',
      body
    })

    expect(doc.id).toBe('content:en:blog:hello-world.md')
    expect(doc.canonicalKey).toBe('blog:blog/hello-world')
    expect(doc.type).toBe('markdown')
  })

  test('omits the optional file object when the provider has no backing file', () => {
    const doc = normalizeProviderDocument({
      collection: 'blog',
      locale: 'en',
      path: '/blog/hello-world',
      body
    })

    expect('file' in doc).toBe(false)
  })

  test('passes provider-supplied identity fields, file and frontmatter through untouched', () => {
    const doc = normalizeProviderDocument({
      id: 'cms:blog:42',
      collection: 'blog',
      locale: 'de',
      path: '/blog/hallo',
      canonicalKey: 'blog:42',
      type: 'markdown',
      body,
      file: { source: 'cms', path: '/de/blog/hallo.md', extension: 'md' },
      title: 'Hallo',
      author: 'jane'
    })

    expect(doc.id).toBe('cms:blog:42')
    expect(doc.canonicalKey).toBe('blog:42')
    expect(doc.file).toEqual({ source: 'cms', path: '/de/blog/hallo.md', extension: 'md' })
    expect(doc.title).toBe('Hallo')
    expect((doc as Record<string, unknown>).author).toBe('jane')
  })

  test('derives a matching id extension for non-markdown document kinds', () => {
    const doc = normalizeProviderDocument({
      collection: 'data',
      locale: 'en',
      path: '/data/versions',
      type: 'yaml',
      body
    })

    expect(doc.id).toBe('content:en:data:versions.yml')
  })

  test('derives the route envelope for a single-locale document', () => {
    const page = shapeProviderDocument({
      collection: 'blog',
      locale: 'en',
      path: '/blog/hello-world',
      body,
      title: 'Hello World'
    })

    expect(page.path).toBe('/blog/hello-world')
    expect(page.unprefixedPath).toBe('/blog/hello-world')
    expect(page.locale).toBe('en')
    expect(page.localePaths).toEqual({})
    expect(page.variants).toEqual([])
    expect(page.resolved).toMatchObject({ locale: 'en', fallback: false, path: '/blog/hello-world' })
    // Frontmatter data survives the shaping.
    expect((page as Record<string, unknown>).title).toBe('Hello World')
  })

  test('projects the localized route path from route mounts', () => {
    const page = shapeProviderDocument({
      collection: 'docs',
      locale: 'de',
      path: '/docs/getting-started',
      body,
      title: 'Einstieg'
    }, {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      route: { en: '/docs', de: '/dokumentation' }
    })

    expect(page.path).toBe('/de/dokumentation/getting-started')
    expect(page.locale).toBe('de')
  })
})
