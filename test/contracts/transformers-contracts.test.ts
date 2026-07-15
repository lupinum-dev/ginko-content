import { describe, expect, test } from 'vitest'
import { fromCSV } from '../../packages/content/src/parsers/from-csv'
import { loadContentComponentEntries, resolveDocumentContentComponents } from '../../packages/content/src/integrations/vue/content-components'

describe('transformer contracts', () => {
  test('path-meta keeps internal fields authoritative over user frontmatter', async () => {
    const pathMeta = (await import('../../packages/content/src/parsers/path-meta')).default

    const transformed = await pathMeta.transform?.({
      id: 'content:en:guide:intro.md',
      title: 'Intro',
      draft: false,
      path: '/frontmatter-path',
      partial: true,
      locale: 'de',
      canonicalKey: 'frontmatter-key',
      collection: 'frontmatter-collection',
      file: {
        source: 'frontmatter-source',
        path: 'frontmatter-file',
        stem: 'frontmatter-stem',
        extension: 'frontmatter-extension'
      },
      body: { type: 'root', children: [] }
    } as any, {
      locales: ['en', 'de'],
      defaultLocale: 'en',
      collectionResolver: () => 'docs'
    })

    expect(transformed).toMatchObject({
      title: 'Intro',
      path: '/guide/intro',
      draft: false,
      partial: false,
      locale: 'en',
      canonicalKey: '/guide/intro',
      collection: 'docs',
      file: {
        source: 'content',
        path: 'en/guide/intro.md',
        stem: 'en/guide/intro',
        extension: 'md'
      }
    })
  })

  test('markdown strips derived localization fields from frontmatter', async () => {
    const markdown = (await import('../../packages/content/src/parsers/markdown')).default

    const parsed = await markdown.parse?.('content:guide/intro.md', [
      '---',
      'title: Intro',
      'resolved:',
      '  locale: de',
      'variants:',
      '  - locale: de',
      '    path: /fake',
      'localePaths:',
      '  de:',
      '    path: /fake',
      'unprefixedPath: /fake',
      '---',
      '# Intro'
    ].join('\n'), { plugins: [] } as any)

    expect(parsed).toMatchObject({ title: 'Intro' })
    expect(parsed).not.toHaveProperty('resolved')
    expect(parsed).not.toHaveProperty('variants')
    expect(parsed).not.toHaveProperty('localePaths')
    expect(parsed).not.toHaveProperty('unprefixedPath')
  })

  test('markdown normalizes relative links, preserves anchors, and leaves external links untouched', async () => {
    const markdown = (await import('../../packages/content/src/parsers/markdown')).default

    await expect(markdown.parse?.('content:test.md', [
      '[intro](./guide/getting-started.md#intro)',
      '[external](https://example.com/docs.md#intro)',
      '[absolute](/guide/getting-started.md#intro)'
    ].join('\n\n'), {
      plugins: []
    } as any)).resolves.toMatchObject({
      id: 'content:test.md',
      type: 'markdown',
      body: {
        children: [
          { type: 'element', tag: 'p', props: {}, children: [{ type: 'element', tag: 'a', props: { href: 'guide/getting-started#intro' }, children: [{ type: 'text', value: 'intro' }] }] },
          { type: 'element', tag: 'p', props: {}, children: [{ type: 'element', tag: 'a', props: { href: 'https://example.com/docs.md#intro' }, children: [{ type: 'text', value: 'external' }] }] },
          { type: 'element', tag: 'p', props: {}, children: [{ type: 'element', tag: 'a', props: { href: '/guide/getting-started.md#intro' }, children: [{ type: 'text', value: 'absolute' }] }] }
        ]
      }
    })
  })

  test('markdown surfaces plugin loading failures explicitly', async () => {
    const markdown = (await import('../../packages/content/src/parsers/markdown')).default

    await expect(markdown.parse?.('content:test.md', '# Title', {
      plugins: [{ name: 'definitely-not-a-real-module', options: {} }]
    } as any)).rejects.toThrow(/definitely-not-a-real-module/)
  })

  test('markdown renders Comark footnotes plugin output', async () => {
    const markdown = (await import('../../packages/content/src/parsers/markdown')).default

    await expect(markdown.parse?.('content:test.md', [
      'A sentence with a note[^source].',
      '',
      '[^source]: This is the footnote text.'
    ].join('\n'), {
      plugins: [{ name: 'footnotes', options: { label: '' } }]
    } as any)).resolves.toMatchObject({
      body: {
        children: [
          {
            type: 'element',
            tag: 'p',
            children: [
              { type: 'text', value: 'A sentence with a note' },
              {
                type: 'element',
                tag: 'sup',
                props: { class: 'footnote-ref' }
              },
              { type: 'text', value: '.' }
            ]
          },
          {
            type: 'element',
            tag: 'section',
            props: { class: 'footnotes' }
          }
        ]
      }
    })
  })

  test('markdown restores Nitro-serialized official Shiki notation transformers', async () => {
    const markdown = (await import('../../packages/content/src/parsers/markdown')).default

    const parsed = await markdown.parse?.('content:test.md', [
      '```ts',
      'const highlighted = true // [!code highlight]',
      'const removed = false // [!code --]',
      'const added = true // [!code ++]',
      '```'
    ].join('\n'), {
      plugins: [
        {
          name: 'highlight',
          options: {
            preStyles: false,
            transformers: [
              { name: '@shikijs/transformers:notation-diff' },
              { name: '@shikijs/transformers:notation-highlight' }
            ]
          }
        }
      ]
    } as any)

    const code = parsed?.body?.children?.[0]?.children?.[0]
    const lines = Array.isArray(code?.children)
      ? code.children.filter((line: any) => Array.isArray(line.props?.class))
      : []
    expect(lines.map((line: any) => line.props?.class)).toEqual([
      ['line', 'highlighted'],
      ['line', 'diff', 'remove'],
      ['line', 'diff', 'add']
    ])
    expect(JSON.stringify(parsed?.body)).not.toContain('[!code')
  })

  test('fromCSV parses quoted commas, escaped quotes, multiline fields, and empty values', () => {
    const tree = fromCSV('name,quote,notes\n"Evan, You","He said ""hi""","line 1\nline 2"\nAna,,""')

    expect(tree.children).toHaveLength(3)
    expect(tree.children[0]!.children.map((column: any) => column.children[0]?.value || '')).toEqual([
      'name',
      'quote',
      'notes'
    ])
    expect(tree.children[1]!.children.map((column: any) => column.children[0]?.value || '')).toEqual([
      'Evan, You',
      'He said "hi"',
      'line 1\nline 2'
    ])
    expect(tree.children[2]!.children.map((column: any) => column.children[0]?.value || '')).toEqual([
      'Ana',
      '',
      ''
    ])
  })

  test('fromCSV distinguishes empty rows and throws on unterminated quoted data', () => {
    const tree = fromCSV('a,b\n,\n1,2')
    expect(tree.children).toHaveLength(3)
    expect(tree.children[1]!.children).toHaveLength(2)
    expect(tree.children[1]!.children.map((column: any) => column.children[0]?.value || '')).toEqual(['', ''])

    expect(() => fromCSV('name\n"unterminated')).toThrow(/quotedData|quoteFence|Cannot close document/)
  })

  test('fromCSV supports the configured delimiter', () => {
    expect(fromCSV('a;b\n1;2', { delimiter: ';' }).children[1]!.children.map((column: any) => column.children[0]?.value || '')).toEqual(['1', '2'])
  })

  test('csv transformer parses rows without the unified runtime dependency', async () => {
    const csv = (await import('../../packages/content/src/parsers/csv')).default

    await expect(csv.parse?.('content:test.csv', 'name,role\nAda,admin', {
      json: true
    } as any)).resolves.toMatchObject({
      id: 'content:test.csv',
      type: 'csv',
      body: [{ name: 'Ada', role: 'admin' }]
    })
  })

  test('component resolver collects nested components and ignores html/text/binding nodes', async () => {
    const body = {
      type: 'root',
      children: [
        { type: 'element', tag: 'div', children: [{ type: 'text', value: 'plain' }] },
        {
          type: 'element',
          tag: 'AlertBox',
          children: [
            {
              type: 'element',
              tag: 'FancyCard',
              children: []
            },
            {
              type: 'element',
              tag: 'span',
              children: [{ tag: 'binding', type: 'element', children: [] }]
            }
          ]
        }
      ]
    }

    expect(loadContentComponentEntries(body, { AlertBox: 'prose-alert' })).toEqual([
      ['AlertBox', 'prose-alert'],
      ['FancyCard', 'FancyCard']
    ])

    await expect(resolveDocumentContentComponents(body, {
      tags: { AlertBox: 'prose-alert' },
      catalog: {
        localComponents: ['ProseAlert', 'FancyCard'],
        localComponentLoaders: {
          ProseAlert: async () => 'ResolvedAlert',
          FancyCard: async () => 'ResolvedFancyCard'
        }
      }
    })).resolves.toEqual({
      AlertBox: 'ResolvedAlert',
      FancyCard: 'ResolvedFancyCard'
    })
  })
})
