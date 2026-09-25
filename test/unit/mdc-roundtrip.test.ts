import { describe, expect, it } from 'vitest'
import {
  createHeadingIdGenerator,
  headingSlugText,
  parseMdcBody,
  parseMdcDocument,
  projectMdcDocument,
  serializeMdcDocument,
  slugifyHeading,
  validatePublicMarkdownAst,
  type MdcDocument,
  type MdcNode,
} from '../../packages/content/src/cms-contract'
import { extractContentToc } from '../../packages/content/src/runtime/app/composables/toc'
import { parseComark } from '../../packages/content/src/core/markdown/parse-comark'

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

  it('escapes a delimiter row in a table cell once', async () => {
    const table: MdcNode = ['table', {}, ['tbody', {}, ['tr', {}, ['td', {}, 'x\n|---|']]]]
    const markdown = await serializeMdcDocument(document(table))
    expect(markdown.split('\n').at(-1)).toBe('| x \\|---\\| |')
    const reparsed = projectMdcDocument(await parseMdcDocument(markdown, { autoClose: false })).body
    expect(JSON.stringify(reparsed)).toContain('"value":"x |---|"')
  })

  it('keeps ordinary colons and braces readable', async () => {
    const text = 'Note: this is 10:30, a: b, Node.js, e.g. v1.2, and {{ value }} or ${x}'
    expect(await serializeMdcDocument(document(paragraph(text)))).toBe(text)
    await roundTrip(document(paragraph(text)))
  })

  it.each([
    ['https://a.com', 'https\\://a.com'],
    ['<https://a.com>', '\\<https\\://a.com>'],
    ['![i](https://a.com/x.png)', '!\\[i\\](https\\://a.com/x.png)'],
    ['mailto:a@b.com', 'mailto\\:a@b.com'],
    ['[x]: http://a.com', '\\[x\\]: http\\://a.com'],
  ])('keeps URL-like text %j as text', async (text, expected) => {
    const markdown = await roundTrip(document(paragraph(text)))
    expect(markdown).toBe(expected)
    expect(await serializeMdcDocument(await parseMdcDocument(markdown, { autoClose: false }))).toBe(markdown)
  })

  it.each([
    ['risky syntax', 'x <b a & b 1. c :d {e} https: '.repeat(7000)],
    ['a run of blanks', `x${' \t'.repeat(100_000)}y\n z`],
    ['blank lines', ' \n'.repeat(100_000)],
    ['entity-like text', `&${'a'.repeat(200_000)}`],
  ])('escapes long text with %s in linear time', async (_name, text) => {
    expect(text.length).toBeGreaterThanOrEqual(200_000)
    const table: MdcNode = ['table', {}, ['tbody', {}, ['tr', {}, ['td', {}, text]]]]
    for (const node of [paragraph(text), ['h2', {}, text] as MdcNode, table]) {
      const started = performance.now()
      await serializeMdcDocument(document(node))
      expect(performance.now() - started).toBeLessThan(200)
    }
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

  it('writes a line break inside a heading as <br>', async () => {
    const parsed = await parseMdcDocument('## a<br>b', { autoClose: false })
    const markdown = await roundTrip(parsed)
    expect(markdown).toBe('## a<br>b')
    await roundTrip(document(['h2', { id: 'ab' }, 'a', ['br', {}], 'b'], paragraph('x', ['br', {}], 'y')))
    expect(await serializeMdcDocument(document(paragraph('x', ['br', {}], 'y')))).toBe('x\\\ny')
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

  it.each([
    ['::card\ntext\n```js\n::inner', ['card']],
    ['> ::card\n> ```\n> ::x', ['blockquote']],
  ])('closes a fence left open at the end before component closers in %j', async (source, tags) => {
    const { body } = await parseMdcBody(source)
    expect(body.children.map(node => node.tag)).toEqual([tags[0] === 'blockquote' ? 'blockquote' : 'card'])
    expect(JSON.stringify(body)).toContain('"tag":"pre"')
    expect(JSON.stringify(body)).not.toContain('"value":"::"')
  })

  it.each([
    ['Text\n\n    ```\n    ::card\n\n::note\nx', ['p', 'pre', 'note']],
    ['::card\n    ```\n    ::x\ntext', ['card']],
  ])('treats indented code, not a fence, as literal in %j', async (source, tags) => {
    const { body } = await parseMdcBody(source)
    const closed = await parseMdcBody(`${source}\n::`, { autoClose: false })
    expect(body.children.map(node => node.tag)).toEqual(tags)
    expect(body).toEqual(closed.body)
  })

  it('does not treat a doubly escaped backslash as an escaped brace', async () => {
    const strict = await parseMdcBody('::card\nx\n::\n\na \\\\{.b}', { autoClose: false })
    const completed = await parseMdcBody('::card\nx\n::\n\na \\\\{.b}')
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

  it('ignores heading-like lines inside fenced code in extractContentToc', async () => {
    const source = '## Setup\n\n```bash\n## a comment\n```\n\n## Setup'
    const { body } = await parseMdcBody(source)
    expect(extractContentToc(source).links.map(link => link.id)).toEqual(body.children.filter(node => node.tag === 'h2').map(node => node.props?.id))
  })

  it('generates an empty id for a heading without ASCII word characters', async () => {
    expect(slugifyHeading('日本語')).toBe('')
    const parsed = await parseMdcDocument('## 日本語', { autoClose: false })
    expect((parsed.nodes[0] as [string, Record<string, unknown>])[1].id).toBe('')
  })

  it('makes extractContentToc and parseMdcBody agree with rendered heading ids', async () => {
    const source = '# Title\n\n## Intro\n\n### Details\n\n## Intro\n\n### Details\n\n## 2. Setup'
    const { body, toc } = await parseMdcBody(source, { tocDepth: 3 })
    const renderedIds = body.children.filter(node => node.tag !== 'h1').map(node => node.props?.id)
    expect(toc?.links.map(link => link.id)).toEqual(renderedIds)
    expect(extractContentToc(source, { depth: 3 }).links.map(link => link.id)).toEqual(renderedIds)
  })
})

describe('typed component properties', () => {
  const values = { cols: 3, ratio: 1.5, expandAll: true, hidden: false, empty: null, list: [1, 'a', true], options: { mode: 'safe', depth: 2 }, label: '3', title: 'true' }

  it('keeps JSON types in colon block syntax', async () => {
    const card: MdcNode = ['card', { ...values, $: { syntax: 'colon', block: 1, sourceName: 'card' } }, 'Body']
    const markdown = await roundTrip(document(card))
    expect(markdown.startsWith('::card\n---\n')).toBe(true)
    const reparsed = projectMdcDocument(await parseMdcDocument(markdown, { autoClose: false })).body.children[0]!
    expect(reparsed.props).toMatchObject(values)
  })

  it('keeps JSON types in nested colon components and leaves string-only siblings inline', async () => {
    const inner: MdcNode = ['note', { title: 'x', $: { syntax: 'colon', block: 1, sourceName: 'note' } }, 'In']
    const deep: MdcNode = ['note', { level: 2, $: { syntax: 'colon', block: 1, sourceName: 'note' } }, 'Deep']
    const typed: MdcNode = ['card', { cols: 2, $: { syntax: 'colon', block: 1, sourceName: 'card' } }, inner, deep]
    const markdown = await roundTrip(document(typed))
    expect(markdown).toContain(':::note{title="x"}')
  })

  it('keeps JSON types in inline colon and angle syntax', async () => {
    await roundTrip(document(paragraph('a ', ['badge', { count: 3, shown: true, none: null, tags: ['x'], meta: { a: 1 }, $: { syntax: 'colon', block: 0, sourceName: 'badge' } }], ' b')))
    await roundTrip(document(paragraph('a ', ['badge', { count: 3, shown: false, $: { syntax: 'angle', block: 0, sourceName: 'Badge' } }], ' b')))
    await roundTrip(document(['callout', { level: 2, open: true, items: [1, 2], $: { syntax: 'angle', block: 1, sourceName: 'Callout' } }, 'x']))
  })

  it.each([
    [{}],
    [{ maxInlineAttributes: 0, blockAttributesStyle: 'frontmatter' as const }],
    [{ maxInlineAttributes: 0, blockAttributesStyle: 'codeblock' as const }],
  ])('keeps string values that look typed in a YAML block with %j', async (options) => {
    const strings = { a: 'true', b: 'false', c: '3', d: 'null', e: 'x' }
    for (const props of [strings, { ...strings, n: 1 }]) {
      const card: MdcNode = ['card', { ...props, $: { syntax: 'colon', block: 1, sourceName: 'card' } }, 'Body']
      const markdown = await serializeMdcDocument(document(card), options)
      const reparsed = await parseMdcDocument(markdown, { autoClose: false })
      const { $: _origin, ...actual } = body(reparsed).children[0]!.props!
      expect(actual, markdown).toEqual(props)
      expect(await serializeMdcDocument(reparsed, options)).toBe(markdown)
    }
  })

  it('keeps JSON types that are parsed from YAML component properties', async () => {
    await roundTrip(await parseMdcDocument('::card\n---\ncols: 3\nexpandAll: true\n---\nBody\n::', { autoClose: false }))
  })
})

describe('component property strings', () => {
  const values = {
    title: 'a\' b=`c" to="javascript:alert(1)',
    label: 'a"b\'c`d',
    open: 'a\nb',
    defaultValue: 'x\n\n# evil',
    crlf: 'a\r\nb\rc',
  }
  const forms: Array<[string, (props: Record<string, unknown>) => MdcNode]> = [
    ['colon block', props => ['card', { ...props, $: { syntax: 'colon', block: 1, sourceName: 'card' } }, 'Body']],
    ['nested colon block', props => ['card', { $: { syntax: 'colon', block: 1, sourceName: 'card' } }, ['note', { ...props, $: { syntax: 'colon', block: 1, sourceName: 'note' } }, 'Body']]],
    ['inline colon', props => paragraph('a ', ['badge', { ...props, $: { syntax: 'colon', block: 0, sourceName: 'badge' } }, 'Body'], ' b')],
    ['angle block', props => ['card', { ...props, $: { syntax: 'angle', block: 1, sourceName: 'Card' } }, 'Body']],
    ['angle inline', props => paragraph('a ', ['badge', { ...props, $: { syntax: 'angle', block: 0, sourceName: 'Badge' } }, 'Body'], ' b')],
  ]

  it.each(forms)('keeps quotes and line breaks in %s properties without injecting syntax', async (_name, build) => {
    for (const [name, value] of Object.entries(values)) {
      // roundTrip requires the same props, so no `to` prop or heading appears.
      const markdown = await roundTrip(document(build({ [name]: value })))
      expect(markdown).not.toMatch(/^# evil/m)
      expect(JSON.stringify(body(await parseMdcDocument(markdown, { autoClose: false })))).not.toContain('"to":')
      expect(await serializeMdcDocument(await parseMdcDocument(markdown, { autoClose: false }))).toBe(markdown)
    }
  })

  it('writes a typed block component next to text in its inline form', async () => {
    const card: MdcNode = ['card', { $: { syntax: 'colon', block: 1, sourceName: 'card' } },
      ['note', { open: 'a\nb', level: 2, $: { syntax: 'colon', block: 1, sourceName: 'note' } }, 'Body'], 'After']
    const markdown = await serializeMdcDocument(document(card))
    expect(markdown).toBe('::card\n<Note open="a&#10;b" :level="2">Body</Note>After\n::')
    const reparsed = projectMdcDocument(await parseMdcDocument(markdown, { autoClose: false })).body.children[0]!
    expect(reparsed.children![0]!.props).toMatchObject({ open: 'a\nb', level: 2 })
    expect(reparsed.children![1]).toEqual({ type: 'text', value: 'After' })
  })

  const typedLooking = ['[1, 2]', '{"a":1}', '[]', '{}', 'null', 'true', 'false', '3', '-1.5']
  const blockForms: Array<[string, (props: Record<string, unknown>) => MdcNode]> = [
    ['colon block', props => ['note', { ...props, $: { syntax: 'colon', block: 1, sourceName: 'note' } }, 'x']],
    ['element without origin metadata', props => ['note', props, 'x']],
    ['projected component', props => ['note', { ...props, $: { component: 1, block: 1 } }, 'x']],
    ['nested colon block', props => ['card', { $: { syntax: 'colon', block: 1, sourceName: 'card' } }, ['note', { ...props, $: { syntax: 'colon', block: 1, sourceName: 'note' } }, 'x']]],
  ]

  it.each(blockForms)('keeps strings that look like JSON or typed values in a %s', async (_name, build) => {
    for (const title of typedLooking) {
      const markdown = await serializeMdcDocument(document(build({ title })))
      // The parser adds origin metadata to an element that had none.
      const withoutOrigin = (value: MdcDocument) => JSON.stringify(body(value), (key, child) => key === '$' ? undefined : child)
      expect(withoutOrigin(await parseMdcDocument(markdown, { autoClose: false })), markdown).toBe(withoutOrigin(document(build({ title }))))
      if (title.startsWith('[') || title.startsWith('{')) expect(markdown).toMatch(/^ *---$/m)
      expect(await serializeMdcDocument(await parseMdcDocument(markdown, { autoClose: false }))).toBe(markdown)
    }
  })

  it('writes the reported JSON-like string as a quoted YAML scalar', async () => {
    const markdown = await serializeMdcDocument(document(['note', { title: '[1, 2]' }, 'x']))
    expect(markdown).toBe('::note\n---\ntitle: "[1, 2]"\n---\nx\n::')
  })

  it.each([
    ['inline colon', paragraph('a ', ['badge', { title: '[1, 2]', $: { syntax: 'colon', block: 0, sourceName: 'badge' } }, 'x'], ' b'), 'a <Badge title="[1, 2]">x</Badge> b'],
    ['inline angle', paragraph('a ', ['badge', { title: '{}', $: { syntax: 'angle', block: 0, sourceName: 'Badge' } }, 'x'], ' b'), 'a <Badge title="{}">x</Badge> b'],
    ['block component next to text', ['card', { $: { syntax: 'colon', block: 1, sourceName: 'card' } }, ['note', { title: '[]', $: { syntax: 'colon', block: 1, sourceName: 'note' } }, 'x'], 'After'], '::card\n<Note title="[]">x</Note>After\n::'],
  ] as Array<[string, MdcNode, string]>)('keeps a JSON-like string in an %s as a quoted angle value', async (_name, node, expected) => {
    expect(await serializeMdcDocument(document(node))).toBe(expected)
    const reparsed = await parseMdcDocument(expected, { autoClose: false })
    expect(JSON.stringify(reparsed.nodes)).toContain('"title":"')
    expect(await serializeMdcDocument(reparsed)).toBe(expected)
  })

  it('keeps an angle block component with a JSON-like string and slots in angle syntax', async () => {
    const source = '<Card title="[1]">\n<template #header>\nh\n</template>\n\nBody text\n</Card>'
    const parsed = await parseMdcDocument(source, { autoClose: false })
    expect((parsed.nodes[0] as [string, Record<string, unknown>])[1].title).toBe('[1]')
    expect(await roundTrip(parsed)).toBe(source)
  })

  it('reads quoted and bound angle values as strings', async () => {
    const parsed = await parseMdcDocument('<Note a="[1, 2]" :b=\'"{}"\' :c="[1]">\nx\n</Note>', { autoClose: false })
    expect(body(parsed).children[0]!.props).toMatchObject({ a: '[1, 2]', b: '{}', c: [1] })
  })

  it('throws a typed error for a JSON-like string in a native attribute list', async () => {
    await expect(serializeMdcDocument(document(paragraph(['a', { href: '/x', rel: '[1]' }, 'l'])))).rejects.toMatchObject({
      name: 'MdcSerializationError',
      code: 'unrepresentable_value',
      path: [0, 2, 1, 'rel'],
    })
  })

  it.each([
    '![[1]](https://a.test/i.png)',
    '![[]](https://a.test/i.png)',
    '![{}](https://a.test/i.png)',
    '![i](https://a.test/i.png "{}")',
    '## Title {#[1]}',
    ':badge[x]{:v=\'[1]\'}',
    'a :badge[x]{:v=\'[1]\'} b',
    '[x](https://a.test "[1]")',
    '```js [1] {1-2} meta "[1]"\nx\n```',
  ])('round-trips %j, whose JSON-like values are not in an attribute list', async (source) => {
    const parsed = await parseMdcDocument(source, { autoClose: false })
    const markdown = await serializeMdcDocument(parsed)
    const reparsed = await parseMdcDocument(markdown, { autoClose: false })
    expect(reparsed.nodes, markdown).toEqual(parsed.nodes)
    expect(await serializeMdcDocument(reparsed)).toBe(markdown)
  })

  it('writes a link title in Markdown syntax so it stays a string', async () => {
    const markdown = await roundTrip(document(paragraph(['a', { href: '/x', title: 'a "[1]" \\ &amp;' }, 'l'])))
    expect(markdown).toBe('[l](/x "a \\"[1]\\" \\\\ \\&amp;")')
  })

  it('reads a quoted YAML property as a string and an unquoted one as JSON', async () => {
    const props = async (source: string) => body(await parseMdcDocument(source, { autoClose: false })).children[0]!.props
    expect(await props('::note\n---\na: "[1, 2]"\nb: \'{}\'\nc: [1, 2]\n---\nx\n::')).toMatchObject({ a: '[1, 2]', b: '{}', c: [1, 2] })
    expect(await props('::note{a="[1, 2]"}\nx\n::')).toMatchObject({ a: [1, 2] })
    const source = '::note\n---\na: "[1]"\nb: 2\nc: "{}"\nd: x\n---\nx\n::'
    expect(await serializeMdcDocument(await parseMdcDocument(source, { autoClose: false }))).toBe(source)
  })
})

describe('component properties inside containers', () => {
  const card = (props: Record<string, unknown>): MdcNode => ['card', { ...props, $: { syntax: 'colon', block: 1, sourceName: 'card' } }, 'Body']
  const component = (child: MdcNode): MdcNode => ['card', { $: { syntax: 'colon', block: 1, sourceName: 'card' } }, child]
  const containers: Array<[string, (node: MdcNode) => MdcNode]> = [
    ['a quote', node => ['blockquote', {}, node]],
    ['a list item', node => ['ul', {}, ['li', {}, node]]],
    ['a list item in a quote', node => ['blockquote', {}, ['ul', {}, ['li', {}, node]]]],
    ['a quote in a list item', node => ['ul', {}, ['li', {}, ['blockquote', {}, node]]]],
    ['a nested quote', node => ['blockquote', {}, ['blockquote', {}, node]]],
    ['a component in a quote', node => ['blockquote', {}, component(node)]],
  ]
  const values = [{ title: 'C:\\path', icon: 'x' }, { title: 'say "hi"' }, { n: 3 }, { b: true }, { t: '[1, 2]' }, { o: { a: [1, 'x'] } }, { a: 'x', b: 'y', c: 'z', d: 'w' }]

  it.each(containers)('keeps property blocks in %s', async (_name, wrap) => {
    for (const props of values) {
      const value = document(wrap(card(props)))
      const markdown = await serializeMdcDocument(value)
      const reparsed = await parseMdcDocument(markdown, { autoClose: false })
      expect(reparsed.nodes, markdown).toEqual(value.nodes)
      expect(await serializeMdcDocument(reparsed)).toBe(markdown)
    }
  })

  it('reads a property block after blockquote and list prefixes', async () => {
    const parsed = await parseMdcDocument('> - ::card\n>   ---\n>   n: 3\n>   t: "[1]"\n>   o:\n>     a: 1\n>   ---\n>   Body\n>   ::', { autoClose: false })
    expect(JSON.stringify(parsed.nodes)).toContain('{"n":3,"t":"[1]","o":{"a":1}')
  })
})

describe('property edge cases', () => {
  it('keeps U+2028 and U+2029 in component properties', async () => {
    const value = 'a\u2028b\u2029c'
    for (const node of [
      ['card', { t: value, $: { syntax: 'colon', block: 1, sourceName: 'card' } }, 'x'],
      paragraph('a ', ['badge', { t: value, $: { syntax: 'colon', block: 0, sourceName: 'badge' } }, 'x'], ' b'),
    ] as MdcNode[]) {
      const markdown = await roundTrip(document(node))
      expect(JSON.stringify((await parseMdcDocument(markdown, { autoClose: false })).nodes)).toContain(JSON.stringify(value))
    }
  })

  it('keeps a heading with a carriage return on one line', async () => {
    for (const text of ['a\rb', 'a\r\nb']) {
      expect(await serializeMdcDocument(document(['h2', {}, text]))).toBe('## a b')
    }
  })

  it('drops properties whose value is undefined', async () => {
    expect(await serializeMdcDocument(document(['card', { a: undefined, $: { syntax: 'colon', block: 1, sourceName: 'card' } }, 'x']))).toBe('::card\nx\n::')
    expect(await serializeMdcDocument(document(['card', { a: undefined, b: 'x', $: { syntax: 'angle', block: 1, sourceName: 'Card' } }, 'x']))).toBe('<Card b="x">\nx\n</Card>')
    expect(await serializeMdcDocument(document(paragraph('a ', ['badge', { a: undefined, $: { syntax: 'colon', block: 0, sourceName: 'badge' } }, 'x'])))).toBe('a :badge[x]')
  })

  const invalidNames = ['1', 'a b', 'k"q', 'a\nb', '---', '@click', '', 'a}b']

  it('writes any property name of a colon block component in its YAML block', async () => {
    for (const name of invalidNames) {
      const card: MdcNode = ['card', { [name]: 'v', $: { syntax: 'colon', block: 1, sourceName: 'card' } }, 'x']
      const markdown = await serializeMdcDocument(document(card))
      expect((await parseMdcDocument(markdown, { autoClose: false })).nodes, markdown).toEqual([card])
    }
  })

  it.each([
    ['inline colon', (name: string) => paragraph('a ', ['badge', { [name]: 'v', $: { syntax: 'colon', block: 0, sourceName: 'badge' } }, 'x'], ' b')],
    ['angle', (name: string) => ['card', { [name]: 'v', $: { syntax: 'angle', block: 1, sourceName: 'Card' } }, 'x'] as MdcNode],
    ['native attribute', (name: string) => paragraph(['a', { href: '/x', [name]: 'v' }, 'l'])],
  ])('throws a typed error for a property name that %s syntax cannot write', async (_form, build) => {
    for (const name of invalidNames) {
      await expect(serializeMdcDocument(document(build(name))), name).rejects.toMatchObject({ name: 'MdcSerializationError', code: 'unrepresentable_value' })
    }
  })
})

describe('links and images', () => {
  it.each([
    [':fire {x} [y] *z*', '![:fire {x} [y] *z*](https://a.test/x.png)'],
    ['a ] b', '![](https://a.test/x.png){alt="a ] b"}'],
  ])('writes image alt text %j so the parser keeps it', async (alt, expected) => {
    const markdown = await roundTrip(document(paragraph(['img', { src: 'https://a.test/x.png', alt }])))
    expect(markdown).toBe(expected)
  })

  it('wraps a destination with parentheses in angle brackets', async () => {
    const markdown = await roundTrip(document(paragraph(['a', { href: 'https://a.test/x_(y' }, 'l'])))
    expect(markdown).toBe('[l](<https://a.test/x_(y>)')
  })

  it('writes a destination with a space so it stays one link', async () => {
    const markdown = await serializeMdcDocument(document(paragraph(['a', { href: 'https://a.test/a b' }, 'l'])))
    expect(markdown).toBe('[l](<https://a.test/a b>)')
    const reparsed = projectMdcDocument(await parseMdcDocument(markdown, { autoClose: false })).body
    // The parser percent-encodes the space, which names the same URL.
    expect(reparsed.children[0]!.children![0]!.props?.href).toBe('https://a.test/a%20b')
  })
})

describe('link recognition', () => {
  it.each([
    ['see a.com now', 'see a\\.com now'],
    ['mail a@b.com today', 'mail a@b\\.com today'],
    ['visit www.example.com', 'visit www.example\\.com'],
    ['at 127.0.0.1', 'at 127.0.0.1'],
    ['file README.md', 'file README\\.md'],
    ['x //cdn.com/y', 'x /\\/cdn.com/y'],
    ['x //localhost/y', 'x /\\/localhost/y'],
    ['a.co.uk', 'a\\.co\\.uk'],
    ['ftp://a.com', 'ftp\\://a.com'],
    ['Node.js, e.g. v1.2', 'Node.js, e.g. v1.2'],
  ])('keeps bare %j as text in the editor and in site content', async (source, expected) => {
    const parsed = await parseMdcDocument(source, { autoClose: false })
    expect(parsed.nodes).toEqual([['p', {}, source]])
    const markdown = await serializeMdcDocument(parsed)
    expect(markdown).toBe(expected)
    // Site content links bare domains; the escape keeps the saved text as text.
    const site = await parseComark(markdown, { autoClose: false })
    expect(site.nodes).toEqual([['p', {}, source]])
    expect((await parseMdcDocument(markdown, { autoClose: false })).nodes).toEqual([['p', {}, source]])
  })

  it('does not escape domains inside link text', async () => {
    expect(await serializeMdcDocument(document(paragraph(['a', { href: '/x' }, 'see a.com'])))).toBe('[see a.com](/x)')
  })

  it.each(['see //evil.com/x here', 'ftp://a.com'])('keeps %j as text', async (source) => {
    const parsed = await parseMdcBody(source)
    expect(parsed.body.children).toEqual([{ type: 'element', tag: 'p', props: {}, children: [{ type: 'text', value: source }] }])
  })

  it('keeps default link recognition for site content', async () => {
    const tree = await parseComark('see www.a.com and a@b.com', { autoClose: false })
    expect(JSON.stringify(tree.nodes)).toContain('"href":"http://www.a.com"')
    expect(JSON.stringify(tree.nodes)).toContain('"href":"mailto:a@b.com"')
  })

  it('links explicit URLs and autolinks', async () => {
    const parsed = await parseMdcBody('<https://a.com> and https://b.com and [c](http://a.De)', { autoClose: false })
    const hrefs = parsed.body.children[0]!.children!.filter(node => node.tag === 'a').map(node => node.props?.href)
    expect(hrefs).toEqual(['https://a.com', 'https://b.com', 'http://a.De'])
    expect(validatePublicMarkdownAst(parsed.body)).toMatchObject({ ok: true })
  })
})
