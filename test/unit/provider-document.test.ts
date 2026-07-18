import { describe, expect, test } from 'vitest'
import { normalizeProviderDocument } from '../../packages/content/src/public/provider-document'

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

  test('accepts the released normalizer output at the provider query seam', () => {
    const document = normalizeProviderDocument({
      collection: 'blog',
      locale: 'en',
      contentPath: '/blog/hello-world',
      body
    })

    expect(normalizeProviderDocument(document)).toEqual(document)
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

  test('accepts JSON-pure structured bodies for data document kinds', () => {
    const body = [{ slug: 'alpha', enabled: true }, { slug: 'beta', enabled: false }]
    const document = normalizeProviderDocument({
      collection: 'catalog',
      locale: 'en',
      contentPath: '/catalog/products',
      type: 'csv',
      body
    })

    expect(document).toMatchObject({
      id: 'content:en:catalog:products.csv',
      type: 'csv',
      body
    })
  })

  test('preserves provenance for public custom-transformer extensions', () => {
    const body = ['Jason', 'Jessi', 'Joes', 'John']
    const document = normalizeProviderDocument({
      collection: 'people',
      locale: 'en',
      contentPath: '/people',
      type: 'json',
      body,
      file: { path: 'people.names', extension: 'names' }
    })

    expect(document).toMatchObject({
      type: 'json',
      body,
      file: { path: 'people.names', extension: 'names' }
    })
  })

  test.each([
    { collection: '', locale: 'en' },
    { collection: 'docs', locale: '' }
  ])('rejects empty provider identity fields: %o', ({ collection, locale }) => {
    expect(() => normalizeProviderDocument({
      collection,
      locale,
      contentPath: '/docs/intro',
      body
    })).toThrow(/collection and locale must be non-empty strings/)
  })

  test('rejects an explicitly empty canonical key', () => {
    expect(() => normalizeProviderDocument({
      collection: 'docs',
      locale: 'en',
      canonicalKey: '',
      contentPath: '/docs/intro',
      body
    })).toThrow(/canonicalKey must be a non-empty string/)
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

    expect(() => normalizeProviderDocument({
      collection: 'docs',
      locale: 'de',
      contentPath: '/dokumentation/einstieg',
      routeVariants: [
        { locale: 'en', contentPath: '/docs/getting-started' },
        { locale: 'de', contentPath: '/dokumentation/einstieg' }
      ],
      body
    })).toThrow(/canonicalKey is required.*multiple locales/)

    expect(() => normalizeProviderDocument({
      ...base,
      routeVariants: [{ locale: 'de', contentPath: '/dokumentation/anderer-pfad' }]
    })).toThrow(/contentPath must match.*resolved locale "de"/)
  })

  test.each([
    ['id', { id: 42 }, /id must be a non-empty string/],
    ['type', { type: 'xml' }, /type must be markdown, yaml, json, or csv/],
    ['body', { body: 'markdown source' }, /body must be null or a root Markdown AST/],
    ['file', { file: 'cms://document/1' }, /file must be an object/],
    ['file extension', { file: { extension: 42 } }, /file.extension must be a string/],
    ['derived path mismatch', { path: '/docs/other' }, /derived "path" must match contentPath/],
    ['derived route', { route: { resolvedPath: '/docs/intro' } }, /"route" is derived by core/],
    ['derived directory metadata', { dir: { badge: 'New' } }, /"dir" is derived by core/]
  ])('rejects invalid or provider-authored system field %s', (_name, overrides, message) => {
    expect(() => normalizeProviderDocument({
      collection: 'docs',
      locale: 'en',
      contentPath: '/docs/intro',
      body,
      ...overrides
    } as never)).toThrow(message as RegExp)
  })

  test.each([
    'https://evil.test/docs/intro',
    '//evil.test/docs/intro',
    'docs/intro',
    '/docs/intro?preview=true',
    '/docs/intro#section',
    '/docs\\intro',
    '/docs/../admin',
    '/docs/intro page',
    '/"><script>alert(1)</script>'
  ])('rejects provider document contentPath outside the site-relative route contract: %s', (contentPath) => {
    expect(() => normalizeProviderDocument({
      collection: 'docs',
      locale: 'en',
      contentPath,
      body
    })).toThrow(/site-relative content route/)
  })

  test('applies the same site-relative route contract to every variant fact', () => {
    expect(() => normalizeProviderDocument({
      collection: 'docs',
      locale: 'en',
      contentPath: '/docs/intro',
      routeVariants: [
        { locale: 'en', contentPath: '/docs/intro' },
        { locale: 'de', contentPath: 'https://evil.test/dokumentation/einstieg' }
      ],
      body
    })).toThrow(/route variant at index 1.*site-relative content route/)
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
