import { describe, expect, test } from 'vitest'
import { parseCmsImportFile, buildCmsImportGraph, type CmsImportContentContext } from '../../packages/content/src/cms-import'

const context: CmsImportContentContext = {
  locales: ['en', 'de'],
  defaultLocale: 'en',
  translatedSlugs: true,
  respectPathCase: false,
  markdown: {
    plugins: [],
    tags: {},
    anchorLinks: {
      depth: 4,
      exclude: [1]
    },
    image: 'auto'
  },
  yaml: {},
  csv: { delimiter: ',', json: true },
  collections: {
    docs: {
      type: 'page',
      source: ['*/1.docs/**/*.md', '*/1.docs/**/*.mdc'],
      i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
      route: { en: '/docs', de: '/dokumentation' }
    },
    data: {
      type: 'data',
      source: 'data/*'
    }
  }
}

describe('cms-import', () => {
  test('parses Markdown and MDC files through the shared content transformer', async () => {
    const markdown = await parseCmsImportFile({
      id: 'content:en/1.docs/1.intro.md',
      context,
      source: [
        '---',
        'title: Intro',
        'ref: docs-intro',
        '---',
        '',
        '# Intro',
        '',
        'Welcome to the docs.'
      ].join('\n')
    })

    expect(markdown.frontmatter).toEqual({
      title: 'Intro',
      ref: 'docs-intro'
    })
    expect(markdown.body).toBe('# Intro\n\nWelcome to the docs.')
    expect(markdown.document).toMatchObject({
      collection: 'docs',
      locale: 'en',
      path: '/docs/intro',
      type: 'markdown',
      title: 'Intro',
      ref: 'docs-intro'
    })

    const mdc = await parseCmsImportFile({
      id: 'content:de/1.docs/1.einstieg.mdc',
      context,
      source: [
        '---',
        'title: Einstieg',
        '---',
        '',
        '# Einstieg',
        '',
        '::callout',
        'Deutscher Inhalt.',
        '::'
      ].join('\n')
    })

    expect(mdc.frontmatter).toEqual({ title: 'Einstieg' })
    expect(mdc.body).toContain('::callout')
    expect(mdc.document).toMatchObject({
      collection: 'docs',
      locale: 'de',
      path: '/docs/einstieg',
      type: 'markdown',
      title: 'Einstieg'
    })
  })

  test('extracts editable records from YAML, JSON, and JSON5 files', async () => {
    await expect(parseCmsImportFile({
      id: 'content:data/settings.yml',
      context,
      source: [
        'title: Settings',
        'enabled: true'
      ].join('\n')
    })).resolves.toMatchObject({
      frontmatter: {
        title: 'Settings',
        enabled: true
      },
      document: {
        collection: 'data',
        type: 'yaml',
        title: 'Settings'
      }
    })

    await expect(parseCmsImportFile({
      id: 'content:data/settings.json',
      context,
      source: '{"title":"JSON Settings","enabled":true}'
    })).resolves.toMatchObject({
      frontmatter: {
        title: 'JSON Settings',
        enabled: true
      },
      document: {
        collection: 'data',
        type: 'json',
        title: 'JSON Settings'
      }
    })

    await expect(parseCmsImportFile({
      id: 'content:data/settings.json5',
      context,
      source: '{ title: "JSON5 Settings", enabled: true }'
    })).resolves.toMatchObject({
      frontmatter: {
        title: 'JSON5 Settings',
        enabled: true
      },
      document: {
        collection: 'data',
        type: 'json',
        title: 'JSON5 Settings'
      }
    })
  })

  test('builds the shared content graph from parsed CMS import documents', async () => {
    const en = await parseCmsImportFile({
      id: 'content:en/1.docs/1.intro.md',
      context,
      source: [
        '---',
        'title: Intro',
        'ref: docs-intro',
        '---',
        '',
        '# Intro'
      ].join('\n')
    })
    const de = await parseCmsImportFile({
      id: 'content:de/1.docs/1.einstieg.md',
      context,
      source: [
        '---',
        'title: Einstieg',
        '---',
        '',
        '# Einstieg'
      ].join('\n')
    })

    const graph = buildCmsImportGraph([en.document, de.document], {
      locales: ['en', 'de'],
      defaultLocale: 'en'
    })

    expect(graph.byCollection.docs).toHaveLength(2)
    expect(graph.byRoute['en:/docs/intro']).toBeTypeOf('string')
    expect(graph.byRoute['de:/docs/einstieg']).toBeTypeOf('string')
    expect(graph.byRef['docs-intro']).toBe(graph.byRoute['en:/docs/intro'])
    expect(Object.values(graph.byCanonical)).toEqual([
      expect.objectContaining({
        en: expect.objectContaining({
          path: '/docs/intro'
        }),
        de: expect.objectContaining({
          path: '/docs/einstieg'
        })
      })
    ])
  })
})
