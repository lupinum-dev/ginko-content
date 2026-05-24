import { describe, expect, test } from 'vitest'
import { createSearchSections } from '../../packages/content/src/features/search/sections'
import { searchRecords } from '../../packages/content/src/runtime/shared/search'

describe('search behavior', () => {
  test('searchRecords returns ranked, locale-scoped result envelopes without indexing empty terms', () => {
    const records = [
      {
        id: '/docs/fallback#overview',
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
        path: '/docs/search',
        title: 'Search',
        excerpt: 'Search configuration',
        content: 'MiniSearch and CMS search',
        headings: ['Index'],
        locale: 'en'
      }
    ]

    expect(searchRecords(records, '   ')).toEqual([])

    const allLocales = searchRecords(records, 'fallback')
    expect(allLocales).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Fallback Lab',
        path: '/docs/fallback',
        anchor: 'overview',
        locale: 'en'
      }),
      expect.objectContaining({
        title: 'Fallback Labor',
        path: '/de/dokumentation/fallback',
        anchor: 'ueberblick',
        locale: 'de'
      })
    ]))

    expect(searchRecords(records, 'fallback', 'de')).toEqual([
      expect.objectContaining({
        title: 'Fallback Labor',
        path: '/de/dokumentation/fallback',
        locale: 'de'
      })
    ])
  })

  test('searchRecords accepts custom MiniSearch fields, boosts, and stored result fields', () => {
    const records = [
      {
        id: '/docs/reference',
        path: '/docs/reference',
        title: 'Reference',
        excerpt: 'API reference',
        content: 'Configuration APIs',
        headings: ['API'],
        tags: ['boring']
      },
      {
        id: '/docs/search',
        path: '/docs/search',
        title: 'Search',
        excerpt: 'Search configuration',
        content: 'MiniSearch setup',
        headings: ['Search'],
        tags: ['important']
      }
    ]

    expect(searchRecords(records, 'important', undefined, {
      fields: ['title', 'content', 'tags'],
      storeFields: ['tags'],
      boost: { tags: 10, title: 1, content: 1 },
      fuzzy: false,
      prefix: false
    })).toEqual([
      expect.objectContaining({
        title: 'Search',
        path: '/docs/search',
        excerpt: 'Search configuration',
        tags: ['important']
      })
    ])
  })

  test('createSearchSections splits markdown into page and heading sections with ignored tags and extra metadata', () => {
    const sections = createSearchSections([
      {
        _path: '/docs/search',
        _locale: 'de',
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
      extraFields: ['_locale'],
      minHeading: 'h2',
      maxHeading: 'h3'
    })

    expect(sections).toEqual([
      expect.objectContaining({
        id: '/docs/search',
        title: 'Search',
        content: 'Find content quickly Intro copy',
        _locale: 'de'
      }),
      expect.objectContaining({
        id: '/docs/search#setup',
        title: 'Setup',
        titles: ['Search'],
        content: 'Install the search index',
        _locale: 'de'
      }),
      expect.objectContaining({
        id: '/docs/search#cms',
        title: 'CMS',
        titles: ['Search', 'Setup'],
        content: 'Provider-backed search',
        _locale: 'de'
      })
    ])
    expect(sections.map(section => section.content).join(' ')).not.toContain('ignored code block')
  })

  test('createSearchSections normalizes inline MDC syntax in result titles', () => {
    const sections = createSearchSections([
      {
        _path: '/',
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
})
