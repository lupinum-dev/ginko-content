import { describe, expect, it } from 'vitest'
import {
  createHeadingIdGenerator,
  headingSlugText,
  parseMdcBody,
  parseMdcDocument,
  projectMdcDocument,
  serializeMdcDocument,
  slugifyHeading,
  type MdcDocument,
  type MdcNode,
} from '../../packages/content/src/cms-contract'
import { extractContentToc } from '../../packages/content/src/runtime/app/composables/toc'

const document = (...nodes: MdcNode[]): MdcDocument => ({ nodes, frontmatter: {}, meta: {} })
const paragraph = (...children: MdcNode[]): MdcNode => ['p', {}, ...children]
const body = (value: MdcDocument) => projectMdcDocument(value).body

/** Serialize, reparse strictly, and require the same public body. */
const roundTrip = async (value: MdcDocument) => {
  const markdown = await serializeMdcDocument(value)
  const reparsed = await parseMdcDocument(markdown, { autoClose: false })
  expect(body(reparsed), markdown).toEqual(body(value))
  return markdown
}

describe('serializeMdcDocument text escaping', () => {
  it.each([
    '::card',
    '::',
    ':::card',
    ':fire',
    ':fire:',
    '10:30:45 :fire: done',
    'a{.b}',
    'a {#id}',
    'a {--accent="red"}',
    'first\n::card',
    'first\n:fire',
    '<Badge b',
    '</Badge>',
    '<!-- x',
    'x\na | b\n:-: | :-:',
    'x\na|b\n-|-',
    'x\n| a | b |\n| --- | --- |',
    '[x]{.y}',
    '**x**{.y}',
    'a \\:b',
  ])('keeps paragraph text %j literal', async (text) => {
    await roundTrip(document(paragraph(text)))
  })

  it.each([
    [':fire', 'after '],
    ['{.b}', 'a'],
    ['::card', ''],
  ])('keeps text %j literal after an inline element', async (text, before) => {
    await roundTrip(document(paragraph(...(before ? [before] : []), ['strong', {}, 'x'], text)))
    await roundTrip(document(paragraph(['em', {}, 'x'], text)))
  })

  it('keeps text literal inside components, headings, lists, and links', async () => {
    await roundTrip(document(
      ['card', { $: { syntax: 'colon', block: 1, sourceName: 'card' } }, paragraph('#tag'), paragraph('::'), paragraph(':note')],
      ['h2', { id: 'fire-a-b' }, ':fire {.a} b'],
      ['ul', {}, ['li', {}, '::card'], ['li', {}, ':fire']],
      paragraph(['a', { href: '/x' }, ':fire{.b}']),
    ))
  })

  it('escapes table-cell text, which Comark copies without escaping', async () => {
    const cell = (tag: 'th' | 'td', text: string): MdcNode => [tag, {}, text]
    await roundTrip(document(['table', {},
      ['thead', {}, ['tr', {}, cell('th', 'a'), cell('th', 'b')]],
      ['tbody', {}, ['tr', {}, cell('td', '*x* [y] `z`'), cell('td', ':fire {.b} a\\|b')]],
    ]))
  })

  it('keeps ordinary colons, braces, and URLs readable', async () => {
    const text = 'Note: this is 10:30 at https://example.com/a:b and {{ value }} or ${x}'
    expect(await serializeMdcDocument(document(paragraph(text)))).toBe(text)
    await roundTrip(document(paragraph('Note: this is 10:30, a: b, and {{ value }}')))
  })

  it('writes minimal escapes', async () => {
    expect(await serializeMdcDocument(document(paragraph('10:30:45 :fire: done')))).toBe('10:30:45 \\:fire: done')
    expect(await serializeMdcDocument(document(paragraph('::card')))).toBe('\\::card')
    expect(await serializeMdcDocument(document(paragraph('a{.b}')))).toBe('a\\{.b}')
  })

  it('keeps inline code and fenced code verbatim', async () => {
    const markdown = await roundTrip(document(
      paragraph('Use ', ['code', {}, '::card{.a} :fire'], ' here'),
      ['pre', { language: 'md' }, ['code', { class: 'language-md' }, '::card\n:fire{.b}\n#slot\n::']],
    ))
    expect(markdown).toContain('`::card{.a} :fire`')
    expect(markdown).toContain('```md\n::card\n:fire{.b}\n#slot\n::\n```')
  })

  it.each([
    '\\:fire\\:',
    '\\::card',
    'a\\{.b}',
    'text \\:badge[x]{.y}',
    '::card\n\\#tag\n::',
    'x\na | b\n\\:-: | :-:',
    '\\<Badge b',
  ])('preserves escaped source %j through parse, serialize, and parse', async (source) => {
    const parsed = await parseMdcDocument(source, { autoClose: false })
    await roundTrip(parsed)
  })
})

describe('serializeMdcDocument heading ids', () => {
  it('omits ids the parser generates', async () => {
    const parsed = await parseMdcDocument('# Hello World\n\n## Intro\n\n### Details\n\n## Intro\n', { autoClose: false })
    expect(await serializeMdcDocument(parsed)).toBe('# Hello World\n\n## Intro\n\n### Details\n\n## Intro')
  })

  it.each([
    ['# Hello {#custom}', '# Hello {#custom}'],
    ['## Intro\n\n### Details {#details}', '## Intro\n\n### Details {#details}'],
    ['# Hello {.lead #custom}', '# Hello {.lead #custom}'],
    ['# Hello {id="a b"}', '# Hello {id="a b"}'],
    ['# Hello {#1abc}', '# Hello {#1abc}'],
  ])('keeps the custom id in %j', async (source, expected) => {
    const parsed = await parseMdcDocument(source, { autoClose: false })
    const markdown = await roundTrip(parsed)
    expect(markdown).toBe(expected)
  })

  it('keeps an edited id and drops an id that matches the generated one', async () => {
    const markdown = await roundTrip(document(
      ['h2', { id: 'changed' }, 'Intro'],
      ['h3', { id: 'intro-details' }, 'Details'],
      ['h2', { id: 'intro-1' }, 'Intro'],
    ))
    expect(markdown).toBe('## Intro {#changed}\n\n### Details\n\n## Intro')
  })

  it('keeps custom ids on headings inside components', async () => {
    await roundTrip(await parseMdcDocument('::card\n## Inside {#inside-id}\n::\n\n## After', { autoClose: false }))
  })
})

describe('parseMdcBody auto-close', () => {
  it.each([
    '```md\n::card\n```',
    '~~~md\n::card\n~~~',
    '````md\n```\n::card\n```\n````',
    '- item\n\n  ```md\n  ::card\n  ```',
    '---\ntitle: "::card"\n---\n\ntext',
  ])('does not close component markers inside code or frontmatter in %j', async (source) => {
    const completed = await parseMdcBody(source)
    const strict = await parseMdcBody(source, { autoClose: false })
    expect(completed.body).toEqual(strict.body)
  })

  it('still closes unfinished components outside code', async () => {
    const { body } = await parseMdcBody('::card\n```md\n::note\n```\nText')
    expect(body.children).toHaveLength(1)
    expect(body.children[0]).toMatchObject({ tag: 'card' })
    expect(body.children[0]!.children!.map(child => child.tag)).toEqual(['pre', 'p'])
  })

  it('does not complete an escaped trailing brace', async () => {
    const { body } = await parseMdcBody('::card\nx\n::\n\na \\{')
    expect(body.children[1]).toEqual({ type: 'element', tag: 'p', props: {}, children: [{ type: 'text', value: 'a {' }] })
  })
})

describe('heading ids', () => {
  it.each([
    ['Hello World', 'hello-world'],
    ['1. Introduction', '_1-introduction'],
    ['Über uns', 'ber-uns'],
    ['  Many   spaces -- here ', 'many-spaces-here'],
    ['C++ & Rust?', 'c-rust'],
  ])('slugifies %j like the parser', async (text, expected) => {
    expect(slugifyHeading(text)).toBe(expected)
    const parsed = await parseMdcDocument(`# ${text}`, { autoClose: false })
    expect((parsed.nodes[0] as [string, Record<string, unknown>])[1].id).toBe(expected)
  })

  it('generates the same document-scoped ids as the parser', async () => {
    const source = [
      '# Title', '## Intro', '### Details', '#### Deep', '### Details', '## Intro',
      '### Details', '## Uses :badge[inline] text', '##### Skip', '# Reset', '### After reset',
    ].join('\n')
    const parsed = await parseMdcDocument(source, { autoClose: false })
    const nextId = createHeadingIdGenerator()
    for (const node of parsed.nodes) {
      if (!Array.isArray(node) || typeof node[0] !== 'string') continue
      const level = Number(node[0].slice(1))
      expect(nextId(headingSlugText(node.slice(2)), level)).toBe(node[1].id)
    }
  })

  it('makes extractContentToc and parseMdcBody agree with rendered heading ids', async () => {
    const source = '# Title\n\n## Intro\n\n### Details\n\n## Intro\n\n### Details\n\n## 2. Setup'
    const { body, toc } = await parseMdcBody(source, { tocDepth: 3 })
    const renderedIds = body.children.filter(node => node.tag !== 'h1').map(node => node.props?.id)
    expect(toc?.links.map(link => link.id)).toEqual(renderedIds)
    expect(extractContentToc(source, { depth: 3 }).links.map(link => link.id)).toEqual(renderedIds)
  })
})
