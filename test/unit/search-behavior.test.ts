import MiniSearch from 'minisearch'
import { describe, expect, test, vi } from 'vitest'
import { createSearchSections } from '../../packages/content/src/features/search/sections'
import { createMiniSearchIndex } from '../../packages/content/src/runtime/shared/search'
import { createSearchExcerpt } from '../../packages/content/src/features/search/snippet'
import { DEFAULT_MINISEARCH_OPTIONS, normalizeMiniSearchOptions } from '../../packages/content/src/features/search/options'
import { createSearchRuntimeConfig, normalizeSearchOptions } from '../../packages/content/src/module/options'

const searchWithFreshIndex = (records: Parameters<typeof createMiniSearchIndex>[0], term: string, locale?: string, options?: Parameters<typeof createMiniSearchIndex>[1]) =>
  createMiniSearchIndex(records, options).search(term, { locale })

describe('search behavior', () => {
  test('one canonical normalizer owns MiniSearch defaults and required result fields', () => {
    const input = {
      fields: ['tags', '', 'tags'],
      storeFields: ['tags', '', 'tags'],
      boost: { tags: 5, invalid: Number.NaN },
      fuzzy: Number.POSITIVE_INFINITY,
      prefix: false
    }
    const canonical = normalizeMiniSearchOptions(input)

    expect(normalizeMiniSearchOptions()).toEqual(DEFAULT_MINISEARCH_OPTIONS)
    expect(canonical).toEqual({
      fields: ['tags'],
      storeFields: ['path', 'title', 'excerpt', 'collection', 'tags'],
      boost: { tags: 5 },
      fuzzy: 0.2,
      prefix: false
    })
    expect(normalizeSearchOptions({ search: { minisearch: input } }).minisearch).toEqual(canonical)
    expect(createSearchRuntimeConfig({
      engine: 'minisearch',
      apiBaseURL: undefined,
      minisearch: input
    }, '/api/_content').minisearch).toEqual(canonical)
  })

  test('the index shapes a contextual plain-text excerpt around the query', () => {
    const records = [{
      id: '/docs/search#lifecycle',
      collection: 'docs',
      path: '/docs/search',
      title: 'Search lifecycle',
      excerpt: 'Static fallback excerpt',
      content: `${'introductory material '.repeat(20)}Restore the generated index once and reuse it for every query.${' trailing material'.repeat(20)}`,
      headings: ['Lifecycle'],
      anchor: 'lifecycle',
      locale: 'en'
    }]

    const [result] = searchWithFreshIndex(records, 'generated index')

    expect(result?.excerpt).toContain('generated index')
    expect(result?.excerpt.length).toBeLessThanOrEqual(242)
    expect(result?.excerpt).not.toContain('<mark>')
  })

  test('indexes keep replacement record arrays independent', () => {
    const addAll = vi.spyOn(MiniSearch.prototype, 'addAll')
    const first = [{
      id: '/docs/first', collection: 'docs', path: '/docs/first', title: 'First', excerpt: '', content: 'cache lifecycle', headings: []
    }]

    const firstIndex = createMiniSearchIndex(first)
    expect(firstIndex.search('lifecycle')).toHaveLength(1)
    expect(firstIndex.search('lifecycle')).toHaveLength(1)
    expect(createMiniSearchIndex([...first, {
      id: '/docs/second', collection: 'docs', path: '/docs/second', title: 'Second', excerpt: '', content: 'cache lifecycle', headings: []
    }]).search('lifecycle')).toHaveLength(2)
    expect(addAll).toHaveBeenCalledTimes(2)
    addAll.mockRestore()
  })

  test('a new index does not reuse stale records after a same-length update', () => {
    const records = [{
      id: '/docs/cache', collection: 'docs', path: '/docs/cache', title: 'Before', excerpt: '', content: 'alpha lifecycle', headings: []
    }]

    const before = createMiniSearchIndex(records)
    expect(before.search('alpha')).toEqual([expect.objectContaining({ title: 'Before' })])
    records[0] = {
      id: '/docs/cache', collection: 'docs', path: '/docs/cache', title: 'After', excerpt: '', content: 'beta lifecycle', headings: []
    }

    const after = createMiniSearchIndex(records)
    expect(after.search('alpha')).toEqual([])
    expect(after.search('beta')).toEqual([expect.objectContaining({ title: 'After' })])
  })

  test('contextual excerpts preserve matches after length-changing Unicode folds', () => {
    const records = [{
      id: '/docs/unicode', collection: 'docs', path: '/docs/unicode', title: 'Unicode', excerpt: '',
      content: `${'İ'.repeat(180)} TARGET ${'tail '.repeat(80)}`, headings: []
    }]

    expect(searchWithFreshIndex(records, 'target')[0]?.excerpt.toLocaleLowerCase()).toContain('target')
  })

  test('contextual excerpts retain matches inside tokens longer than the excerpt window', () => {
    const records = [{
      id: '/docs/token', collection: 'docs', path: '/docs/token', title: 'Long token', excerpt: '',
      content: `${'x'.repeat(300)}needle${'y'.repeat(300)}`, headings: []
    }]

    expect(createSearchExcerpt(records[0]!.content, 'needle')).toContain('needle')
  })

  test('contextual excerpts remain bounded at both edges and with combining characters', () => {
    const combiningMatch = 'Cafe\u0301'
    const atStart = createSearchExcerpt(`${combiningMatch} ${'tail '.repeat(100)}`, combiningMatch)
    const atEnd = createSearchExcerpt(`${'lead '.repeat(100)}${combiningMatch}`, combiningMatch)

    expect(atStart).toContain(combiningMatch)
    expect(atEnd).toContain(combiningMatch)
    expect(atStart.length).toBeLessThanOrEqual(240)
    expect(atEnd.length).toBeLessThanOrEqual(240)
  })

  test('the index returns ranked, locale-scoped result envelopes without indexing empty terms', () => {
    const records = [
      {
        id: '/docs/fallback#overview',
        collection: 'docs',
        path: '/docs/fallback',
        title: 'Fallback Lab',
        excerpt: 'Fallback behavior for docs',
        content: 'Fallback route matching and diagnostics',
        headings: ['Overview'],
        anchor: 'overview',
        locale: 'en'
      },
      {
        id: '/de/dokumentation/fallback#ueberblick',
        collection: 'docs',
        path: '/de/dokumentation/fallback',
        title: 'Fallback Labor',
        excerpt: 'Fallback Verhalten fuer Dokumentation',
        content: 'Fallback Routen und Diagnosen',
        headings: ['Ueberblick'],
        anchor: 'ueberblick',
        locale: 'de'
      },
      {
        id: '/docs/search',
        collection: 'docs',
        path: '/docs/search',
        title: 'Search',
        excerpt: 'Search configuration',
        content: 'MiniSearch and CMS search',
        headings: ['Index'],
        locale: 'en'
      }
    ]

    expect(searchWithFreshIndex(records, '   ')).toEqual([])

    const allLocales = searchWithFreshIndex(records, 'fallback')
    expect(allLocales).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Fallback Lab',
        collection: 'docs',
        path: '/docs/fallback',
        anchor: 'overview',
        locale: 'en'
      }),
      expect.objectContaining({
        title: 'Fallback Labor',
        collection: 'docs',
        path: '/de/dokumentation/fallback',
        anchor: 'ueberblick',
        locale: 'de'
      })
    ]))

    expect(searchWithFreshIndex(records, 'fallback', 'de')).toEqual([
      expect.objectContaining({
        title: 'Fallback Labor',
        collection: 'docs',
        path: '/de/dokumentation/fallback',
        locale: 'de'
      })
    ])
  })

  test('the index accepts custom MiniSearch fields, boosts, and stored result fields', () => {
    const records = [
      {
        id: '/docs/reference',
        collection: 'docs',
        path: '/docs/reference',
        title: 'Reference',
        excerpt: 'API reference',
        content: 'Configuration APIs',
        headings: ['API'],
        tags: ['boring']
      },
      {
        id: '/docs/search',
        collection: 'docs',
        path: '/docs/search',
        title: 'Search',
        excerpt: 'Search configuration',
        content: 'MiniSearch setup',
        headings: ['Search'],
        tags: ['important']
      }
    ]

    expect(searchWithFreshIndex(records, 'important', undefined, {
      fields: ['title', 'content', 'tags'],
      storeFields: ['tags'],
      boost: { tags: 10, title: 1, content: 1 },
      fuzzy: false,
      prefix: false
    })).toEqual([
      expect.objectContaining({
        title: 'Search',
        collection: 'docs',
        path: '/docs/search',
        excerpt: 'Search configuration',
        tags: ['important']
      })
    ])
  })

  test('createSearchSections splits markdown into page and heading sections with ignored tags and extra metadata', () => {
    const sections = createSearchSections([
      {
        path: '/docs/search',
        locale: 'de',
        title: 'Search',
        description: 'Find content quickly',
        body: {
          type: 'root',
          children: [
            {
              type: 'element',
              tag: 'p',
              props: {},
              children: [{ type: 'text', value: 'Intro copy' }]
            },
            {
              type: 'element',
              tag: 'h2',
              props: { id: 'setup' },
              children: [{ type: 'text', value: 'Setup' }]
            },
            {
              type: 'element',
              tag: 'p',
              props: {},
              children: [{ type: 'text', value: 'Install the search index' }]
            },
            {
              type: 'element',
              tag: 'pre',
              props: {},
              children: [{ type: 'text', value: 'ignored code block' }]
            },
            {
              type: 'element',
              tag: 'h3',
              props: { id: 'cms' },
              children: [{ type: 'text', value: 'CMS' }]
            },
            {
              type: 'element',
              tag: 'p',
              props: {},
              children: [{ type: 'text', value: 'Provider-backed search' }]
            }
          ]
        }
      }
    ], {
      extraFields: ['locale'],
      minHeading: 'h2',
      maxHeading: 'h3'
    })

    expect(sections).toEqual([
      expect.objectContaining({
        id: '/docs/search',
        title: 'Search',
        content: 'Find content quickly Intro copy',
        locale: 'de'
      }),
      expect.objectContaining({
        id: '/docs/search#setup',
        title: 'Setup',
        titles: ['Search'],
        content: 'Install the search index',
        locale: 'de'
      }),
      expect.objectContaining({
        id: '/docs/search#cms',
        title: 'CMS',
        titles: ['Search', 'Setup'],
        content: 'Provider-backed search',
        locale: 'de'
      })
    ])
    expect(sections.map(section => section.content).join(' ')).not.toContain('ignored code block')
  })

  test('createSearchSections uses the public route envelope', () => {
    const sections = createSearchSections([
      {
        route: { resolvedPath: '/docs/public-route' },
        path: '/docs/private-path',
        title: 'Public route',
        body: { type: 'root', children: [] }
      },
      {
        path: '/docs/path-fallback',
        title: 'Path fallback',
        body: { type: 'root', children: [] }
      }
    ])

    expect(sections.map(section => section.id)).toEqual([
      '/docs/public-route',
      '/docs/path-fallback'
    ])
  })

  test('createSearchSections normalizes inline MDC syntax in result titles', () => {
    const sections = createSearchSections([
      {
        path: '/',
        title: 'Ship Your [SaaS]{class="text-primary"} at light speed',
        description: 'Build faster',
        body: {
          type: 'root',
          children: []
        }
      }
    ])

    expect(sections[0]).toEqual(expect.objectContaining({
      title: 'Ship Your SaaS at light speed'
    }))
  })

  test('copies only own extra fields without changing search record prototypes', () => {
    const page = Object.assign(Object.create({ inherited: 'hidden' }) as Record<string, unknown>, {
      path: '/docs/safe',
      title: 'Safe',
      body: { type: 'root', children: [] }
    })
    Object.defineProperty(page, '__proto__', {
      value: { source: 'frontmatter' },
      enumerable: true,
      configurable: true,
      writable: true
    })

    const [section] = createSearchSections([page as any], {
      extraFields: ['inherited', '__proto__']
    })

    expect(Object.getPrototypeOf(section)).toBe(Object.prototype)
    expect(section).not.toHaveProperty('inherited')
    expect(Object.hasOwn(section!, '__proto__')).toBe(true)
    expect((section as Record<string, unknown>).__proto__).toEqual({ source: 'frontmatter' })
  })
})
