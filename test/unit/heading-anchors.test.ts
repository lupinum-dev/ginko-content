import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import MarkdownRenderer from '../../packages/content/src/runtime/app/components/internal/MarkdownRenderer'
import { parseMdcBody, parseMdcDocument, projectMdcDocument, serializeMdcDocument, type MdcDocument } from '../../packages/content/src/cms-contract/mdc'
import { resolveHeadingAnchors } from '../../packages/content/src/core/markdown/heading-id'
import { validateStoredPortableMarkdownAst, type PortableComponentPolicy } from '../../packages/content/src/cms-contract'
import { extractContentToc } from '../../packages/content/src/runtime/app/composables/toc'

const headings = (text: string[]) => text.map(value => ({ text: value, level: 2 }))

describe('Unicode heading anchors', () => {
  it.each([
    [['Über', 'Ber'], [{ id: 'über', aliases: ['ber'] }, { id: 'ber-1', aliases: [] }]],
    [['Ber', 'Über'], [{ id: 'ber', aliases: [] }, { id: 'über', aliases: ['ber-1'] }]],
    [['日本語', '日本語', '中文'], [{ id: '日本語', aliases: [] }, { id: '日本語-1', aliases: ['-1'] }, { id: '中文', aliases: ['-2'] }]],
    [['A', 'A-1', 'A'], [{ id: 'a', aliases: [] }, { id: 'a-1', aliases: [] }, { id: 'a-2', aliases: [] }]],
  ])('reserves legacy fragments for %j', (text, expected) => {
    const result = resolveHeadingAnchors(headings(text as string[]))
    expect(result).toEqual(expected)
    const ids = result.flatMap(anchor => [anchor.id, ...anchor.aliases])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('uses allocated parent ids and preserves old child fragments', () => {
    expect(resolveHeadingAnchors([
      { text: 'Über', level: 2 }, { text: 'Details', level: 3 },
      { text: 'Über', level: 2 }, { text: 'Details', level: 3 },
    ])).toEqual([
      { id: 'über', aliases: ['ber'] }, { id: 'über-details', aliases: ['ber-details'] },
      { id: 'über-1', aliases: ['ber-1'] }, { id: 'über-1-details', aliases: ['ber-details-1'] },
    ])
  })

  it('keeps explicit ids authoritative and never emits an occupied alias', () => {
    expect(resolveHeadingAnchors([
      { text: 'Über', level: 2 }, { text: 'Elsewhere', level: 2, id: 'ber' },
    ])).toEqual([{ id: 'über', aliases: [] }, { id: 'ber', aliases: ['elsewhere'] }])
    expect(resolveHeadingAnchors(headings(['Über']), ['ber'])).toEqual([{ id: 'über', aliases: [] }])
  })

  it('keeps parser, source TOC and body projection aligned through a round trip', async () => {
    const source = '## Über\n\n## Ber\n\n## 日本語\n\n### 詳細\n\n## 日本語\n\n### 詳細'
    const parsed = await parseMdcDocument(source)
    const ids = parsed.nodes.map(node => Array.isArray(node) ? node[1].id : undefined)
    expect(ids).toEqual(['über', 'ber-1', '日本語', '日本語-詳細', '日本語-1', '日本語-1-詳細'])
    const body = await parseMdcBody(source)
    expect(body.toc?.links.map(link => link.id)).toEqual(ids)
    expect(extractContentToc(source).links.map(link => link.id)).toEqual(ids)
    expect(await parseMdcDocument(await serializeMdcDocument(parsed))).toEqual(parsed)
  })

  it('renders real aliases, including a host prose component, without modifying the tree', async () => {
    const { body } = await parseMdcBody('## Über\n\n## Ber\n\n## 日本語\n\n## 日本語')
    const before = JSON.stringify(body)
    const html = await renderToString(createSSRApp({ render: () => h(MarkdownRenderer, {
      tree: body,
      components: { ProseH2: { setup: (_props: unknown, { slots, attrs }: { slots: { default?: () => unknown }, attrs: Record<string, unknown> }) => () => h('h2', attrs, slots.default?.()) } },
    }) }))
    expect(html).toContain('<h2 id="über"><span id="ber"')
    expect(html).toContain('<h2 id="ber-1">Ber</h2>')
    expect(html).toContain('<h2 id="日本語-1"><span id="-1"')
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map(match => match[1])
    expect(new Set(ids).size).toBe(ids.length)
    expect(JSON.stringify(body)).toBe(before)
  })

  it.each<PortableComponentPolicy>([{ components: {} }, { version: 2, components: {} }])('reads existing stored headings under policy %j without changing metadata', async (renderPolicy) => {
    const document: MdcDocument = { frontmatter: {}, meta: {}, nodes: [
      ['h2', { id: 'ber' }, 'Über'], ['h3', { id: 'ber-details' }, 'Details'],
      ['h2', { id: '' }, '日本語'], ['h2', { id: '-1' }, '日本語'],
    ] }
    const before = JSON.stringify(document)
    const { body } = projectMdcDocument(document)
    expect(validateStoredPortableMarkdownAst(body, renderPolicy).ok).toBe(true)
    const html = await renderToString(createSSRApp({ render: () => h(MarkdownRenderer, { tree: body, renderPolicy }) }))
    expect(html).toContain('<h2 id="ber">Über</h2>')
    expect(html).toContain('<h2 id="-1">日本語</h2>')
    expect(body.children.map(node => node.props?.id)).toEqual(['ber', 'ber-details', '', '-1'])
    expect(JSON.stringify(document)).toBe(before)
  })

  it('does not attach generated ids to authored native HTML headings', async () => {
    const parsed = await parseMdcDocument('<h2>\nHello\n</h2>')
    expect(Array.isArray(parsed.nodes[0]) && parsed.nodes[0][1]).not.toHaveProperty('id')
    expect(await parseMdcDocument(await serializeMdcDocument(parsed))).toEqual(parsed)
  })

  it('normalizes composed and decomposed accents to the same nonempty slug', async () => {
    const parsed = await parseMdcDocument('## Café\n\n## Cafe\u0301\n\n## !!!')
    expect(parsed.nodes.map(node => Array.isArray(node) ? node[1].id : undefined)).toEqual(['café', 'café-1', 'heading'])
  })
})
