import { describe, expect, it } from 'vitest'
import {
  assertCmsRequestedFacts, parseCmsListWireResult, parseCmsPageWireResult,
  parseCmsRoutesWireResult
} from '../../packages/content/src/cms-contract/provider-wire'

const locale = { requested: 'en', resolved: 'en', policy: 'strict', fallbacks: { fields: [] } }
const entry = {
  id: 'entry-1', collection: 'docs',
  route: { slug: 'guide', path: '/guide', locale: 'en', source: 'published' },
  translations: [], locale, title: 'Guide', data: { description: 'Safe' },
  bodyAst: { type: 'root', children: [] }, publishedAt: '2026-07-13T00:00:00.000Z',
  updatedAt: '2026-07-13T00:00:00.000Z', revision: 'revision-1', stableId: 'canonical-1'
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
      pageInfo: { hasNextPage: false, endCursor: null }
    })).toThrow(/ISO date/i)
    expect(() => parseCmsListWireResult({
      entries: [], pageInfo: { hasNextPage: true, endCursor: null }, collection: 'docs', locale
    })).toThrow(/cursor/i)
  })

  it('rejects a collection or requested locale substitution', () => {
    expect(() => assertCmsRequestedFacts({
      operation: 'list', requested: { collection: 'docs', locale: 'en' },
      returned: { collection: 'other', locale: { requested: 'fr' } }
    })).toThrow(/collection/i)
  })
})
