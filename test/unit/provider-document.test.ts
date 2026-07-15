import { describe, expect, test } from 'vitest'
import { normalizeProviderDocument } from '../../packages/content/src/runtime/server/provider-document'

const body = { type: 'root' as const, children: [] }

describe('provider document normalization', () => {
  test('derives stable identity for a minimal single-locale document', () => {
    const document = normalizeProviderDocument({
      collection: 'blog',
      locale: 'en',
      contentPath: '/blog/hello-world',
      body
    })

    expect(document).toMatchObject({
      id: 'content:en:blog:hello-world.md',
      canonicalKey: 'blog:blog/hello-world',
      collection: 'blog',
      locale: 'en',
      path: '/blog/hello-world',
      contentPath: '/blog/hello-world',
      type: 'markdown',
      routeVariants: [{ locale: 'en', contentPath: '/blog/hello-world' }]
    })
    expect('file' in document).toBe(false)
  })

  test('preserves provider identity, provenance, variants, and frontmatter', () => {
    const document = normalizeProviderDocument({
      id: 'cms:blog:42',
      collection: 'blog',
      locale: 'de',
      contentPath: '/magazin/hallo/',
      canonicalKey: 'blog:42',
      routeVariants: [
        { locale: 'en', contentPath: '/blog/hello' },
        { locale: 'de', contentPath: '/magazin/hallo' }
      ],
      body,
      file: { source: 'cms', path: '/de/blog/hallo.md', extension: 'md' },
      title: 'Hallo',
      author: 'jane'
    })

    expect(document).toMatchObject({
      id: 'cms:blog:42',
      canonicalKey: 'blog:42',
      path: '/magazin/hallo',
      file: { source: 'cms', path: '/de/blog/hallo.md', extension: 'md' },
      title: 'Hallo',
      author: 'jane'
    })
    expect(document.routeVariants).toEqual([
      { locale: 'en', contentPath: '/blog/hello' },
      { locale: 'de', contentPath: '/magazin/hallo' }
    ])
  })

  test('derives the backing extension from non-markdown document kinds', () => {
    const document = normalizeProviderDocument({
      collection: 'data',
      locale: 'en',
      contentPath: '/versions',
      type: 'yaml',
      body
    })

    expect(document.id).toBe('content:en:versions.yml')
  })

  test('rejects ambiguous or incomplete localized variant facts', () => {
    const base = {
      collection: 'docs',
      locale: 'de',
      contentPath: '/dokumentation/einstieg',
      canonicalKey: 'docs:getting-started',
      body
    }

    expect(() => normalizeProviderDocument({
      ...base,
      routeVariants: [
        { locale: 'de', contentPath: '/dokumentation/einstieg' },
        { locale: 'de', contentPath: '/dokumentation/start' }
      ]
    })).toThrow(/appears more than once/)

    expect(() => normalizeProviderDocument({
      ...base,
      routeVariants: [{ locale: 'en', contentPath: '/docs/getting-started' }]
    })).toThrow(/must include the resolved locale "de"/)
  })

  test('rejects non-JSON provider data before graph insertion', () => {
    expect(() => normalizeProviderDocument({
      collection: 'blog',
      locale: 'en',
      contentPath: '/blog/invalid',
      body,
      publishedAt: new Date('2026-01-01T00:00:00.000Z')
    })).toThrow(/non-JSON value/)
  })
})
