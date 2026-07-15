import { describe, expect, it } from 'vitest'
import {
  assertCmsRequestedFacts, cmsPublicEntryWireSchema, parseCmsListWireResult, parseCmsNavWireResult,
  parseCmsPageWireResult, parseCmsRoutesWireResult, parseCmsSiteDataWireResult
} from '../../packages/content/src/cms-contract/provider-wire'

const locale = { requested: 'en', resolved: 'en', policy: 'strict', fallbacks: { fields: [] } }
const entry = {
  id: 'entry-1', collection: 'docs',
  route: { slug: 'guide', path: '/guide', locale: 'en', source: 'published' },
  translations: [], locale, title: 'Guide', data: { description: 'Safe' },
  bodyAst: { type: 'root', children: [] }, publishedAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z', revision: 'revision-1', stableId: 'canonical-1',
  assetFacts: []
}

describe('CMS provider wire decoders', () => {
  it('parses exact page and bounded cursor envelopes', () => {
    expect(parseCmsPageWireResult({
      status: 'found', page: entry, collection: 'docs', locale, breadcrumbs: [],
      seo: { title: 'Guide', description: '', canonical: '/guide', alternates: [], xDefault: null }
    }).status).toBe('found')
    expect(parseCmsListWireResult({
      entries: [entry], pageInfo: { hasNextPage: true, endCursor: 'opaque' },
      collection: 'docs', locale
    }).entries).toHaveLength(1)
    expect(parseCmsRoutesWireResult({
      routes: [], pageInfo: { hasNextPage: false, endCursor: null }, snapshot: 'generation-1'
    }).snapshot).toBe('generation-1')
  })

  it('accepts only bounded structured asset facts with credential-free HTTPS URLs', () => {
    const fact = {
      fieldPath: 'data.hero.src', assetId: 'asset-1', url: 'https://assets.example/hero.png',
      expiresAt: null, mediaType: 'image/png', bytes: 68, sha256: '0'.repeat(64)
    }
    expect(parseCmsListWireResult({
      entries: [{ ...entry, assetFacts: [fact] }],
      pageInfo: { hasNextPage: false, endCursor: null }, collection: 'docs', locale
    }).entries[0]?.assetFacts).toEqual([fact])
    for (const invalid of [
      { ...fact, fieldPath: 'data.__proto__.src' },
      { ...fact, url: 'https://user:secret@assets.example/hero.png' },
      { ...fact, url: 'http://assets.example/hero.png' }
    ]) {
      expect(() => parseCmsListWireResult({
        entries: [{ ...entry, assetFacts: [invalid] }],
        pageInfo: { hasNextPage: false, endCursor: null }, collection: 'docs', locale
      })).toThrow(/asset|credential|HTTPS|field path/i)
    }
  })

  it('rejects projected fields, unsafe paths, invalid dates, and malformed cursors', () => {
    expect(() => parseCmsListWireResult({
      entries: [{ ...entry, data: { path: '/injected' } }],
      pageInfo: { hasNextPage: false, endCursor: null }, collection: 'docs', locale
    })).toThrow(/projected field/i)
    expect(() => parseCmsPageWireResult({
      status: 'redirect', page: null, collection: 'docs', locale, breadcrumbs: [], seo: null,
      redirectTo: { slug: 'x', path: 'https://user:secret@example.com/x', locale: 'en', source: 'published' },
      redirectedFrom: '/old'
    })).toThrow(/site-relative path/i)
    expect(() => parseCmsRoutesWireResult({
      routes: [{ collection: 'docs', stableId: 'x', locale: 'en', path: '/x', sitemapIncluded: true, lastmod: 'yesterday' }],
      pageInfo: { hasNextPage: false, endCursor: null }, snapshot: 'generation-1'
    })).toThrow(/ISO date/i)
    expect(() => parseCmsRoutesWireResult({
      routes: [], pageInfo: { hasNextPage: false, endCursor: null }
    })).toThrow(/snapshot/i)
    expect(() => parseCmsListWireResult({
      entries: [], pageInfo: { hasNextPage: true, endCursor: null }, collection: 'docs', locale
    })).toThrow(/cursor/i)
  })

  it('rejects a collection or requested locale substitution', () => {
    expect(() => assertCmsRequestedFacts({
      operation: 'list', requested: { collection: 'docs', locale: 'en' },
      returned: { collection: 'other', locale: { requested: 'fr' } }
    })).toThrow(/collection/i)
    expect(() => assertCmsRequestedFacts({
      operation: 'list', requested: { collection: 'docs', locale: 'en' },
      returned: {
        collection: 'docs', locale: { requested: 'en' },
        entries: [{ ...entry, collection: 'other' } as never]
      }
    })).toThrow(/substituted another collection/i)
  })

  it('rejects hostile wire depth before recursive schema decoding', () => {
    let data: unknown = 'leaf'
    for (let depth = 0; depth < 80; depth++) data = { child: data }

    expect(() => parseCmsSiteDataWireResult({
      key: 'deep', data, locale
    })).toThrow(/depth|bounded|limit/i)

    let node: unknown = { entry, children: [] }
    for (let depth = 0; depth < 80; depth++) node = { entry, children: [node] }
    expect(() => parseCmsNavWireResult({
      tree: [node], collection: 'docs', locale
    })).toThrow(/depth|bounded|limit/i)
  })

  it('rejects oversized strings and containers before Zod clones them', () => {
    expect(cmsPublicEntryWireSchema.safeParse({
      ...entry,
      title: 'x'.repeat(1024 * 1024 + 1)
    }).success).toBe(false)

    expect(() => parseCmsSiteDataWireResult({
      key: 'large-string', data: 'x'.repeat(1024 * 1024 + 1), locale
    })).toThrow(/string|bounded|limit/i)

    expect(() => parseCmsSiteDataWireResult({
      key: 'large-array', data: Array.from({ length: 2001 }, () => null), locale
    })).toThrow(/container|array|bounded|limit/i)

    expect(() => parseCmsSiteDataWireResult({
      key: 'wide-object',
      data: Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`key-${index}`, index])),
      locale
    })).toThrow(/container|object|bounded|limit/i)

    expect(() => parseCmsSiteDataWireResult({
      key: 'many-nodes',
      data: Array.from({ length: 101 }, () => Array.from({ length: 1000 }, () => null)),
      locale
    })).toThrow(/node count|bounded|limit/i)
  })
})
