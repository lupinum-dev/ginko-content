import { describe, expect, it } from 'vitest'
import {
  parseMdcDocument,
  projectMdcDocument,
  serializeMdcDocument,
  validateStoredPortableMarkdownAst,
  type PortableComponentPolicyV2,
  type MdcDocument,
  type MdcNode,
} from '../../packages/content/src/cms-contract'
import type { MarkdownNode } from '../../packages/content/src/types/content'
import { extractMarkdownText } from '../../packages/content/src/core/markdown/tree'

// Seeded generator: a failure prints its seed and reproduces exactly. Set
// MDC_ROUNDTRIP_SEEDS to search more seeds locally.
const SEED_COUNT = Number(process.env.MDC_ROUNDTRIP_SEEDS) || 8
const SEEDS = Array.from({ length: SEED_COUNT }, (_, index) => 0x5EED + index * 7919)
const CASES_PER_SEED = 60

const createRandom = (seed: number) => {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  const int = (max: number) => Math.floor(next() * max)
  const pick = <T>(values: readonly T[]): T => values[int(values.length)]!
  return { next, int, pick }
}

type Random = ReturnType<typeof createRandom>

// Risky tokens: MDC and CommonMark syntax characters plus ordinary words. The
// set excludes `.` and `@`, so plain text does not form linkified domains.
const RISKY = [
  ':', '::', ':::', '{', '}', '{{', '}}', '#', '-', '*', '_', '`', '[', ']', '<', '>', '|', '\\',
  '!', '$', '~', '=', '+', '(', ')', '"', "'", '&', '1)', '2', 'x', 'fire', 'card', 'Badge',
  ':fire', ':fire:', ':card[x]', '{.b}', '{#id}', '{a="b"}', '<Badge>', '</Badge>', '<!--', '#tag',
  '10:30', 'Note:', 'a_b', '&amp;', '---', '***', '```', '~~~',
]
const WORDS = ['alpha', 'beta', 'gamma', 'Note:', '10:30', 'x', 'y']

const inlineText = (random: Random, length = 1 + random.int(6)) => {
  let text = ''
  for (let index = 0; index < length; index++) {
    const token = random.next() < 0.7 ? random.pick(RISKY) : random.pick(WORDS)
    const separator = index === 0 ? '' : random.pick(['', ' ', ' '])
    text += separator + token
  }
  return text
}

/** A Markdown source document built from risky block and inline constructs. */
const generateSource = (random: Random): string => {
  const blocks: string[] = []
  const count = 1 + random.int(4)
  for (let index = 0; index < count; index++) {
    switch (random.int(10)) {
      case 0: blocks.push(`${'#'.repeat(1 + random.int(4))} ${inlineText(random)}`); break
      case 1: blocks.push(`- ${inlineText(random)}\n- ${inlineText(random)}`); break
      case 2: blocks.push(`1. ${inlineText(random)}\n2. ${inlineText(random)}`); break
      case 3: blocks.push(`| a | b |\n| --- | --- |\n| ${inlineText(random, 2)} | ${inlineText(random, 2)} |`); break
      case 4: blocks.push(`\`\`\`md\n${inlineText(random)}\n::card\n${inlineText(random)}\n\`\`\``); break
      case 5: blocks.push(`::card{title="${random.pick(['x', 'a b', 'Note: y'])}"}\n${inlineText(random)}\n::`); break
      case 6: blocks.push(`::card\n${inlineText(random)}\n#footer\n${inlineText(random)}\n::`); break
      case 7: blocks.push(`> ${inlineText(random)}`); break
      case 8: blocks.push(`${inlineText(random)} \`${inlineText(random, 2).replace(/`/g, '')}\` ${inlineText(random)}`); break
      default: blocks.push(`${inlineText(random)}\n${inlineText(random)}`)
    }
  }
  return blocks.join('\n\n')
}

/** An editing document with risky text leaves, as an editor may produce it. */
const generateDocument = (random: Random): MdcDocument => {
  // The parser trims paragraph edges and line ends, so generated text does too.
  const text = (length?: number) => inlineText(random, length).trim() || 'x'
  const inline = (): MdcNode[] => {
    const children: MdcNode[] = [text()]
    if (random.next() < 0.4) children.push(' ', [random.pick(['strong', 'em']), {}, text(2)], ` ${text(2)}`)
    return children
  }
  const nodes: MdcNode[] = []
  const count = 1 + random.int(4)
  for (let index = 0; index < count; index++) {
    switch (random.int(5)) {
      case 0: nodes.push([`h${2 + random.int(3)}`, {}, text()]); break
      case 1: nodes.push(['ul', {}, ['li', {}, ...inline()], ['li', {}, text()]]); break
      case 2: nodes.push(['table', {},
        ['thead', {}, ['tr', {}, ['th', {}, 'a'], ['th', {}, 'b']]],
        ['tbody', {}, ['tr', {}, ['td', {}, text(2)], ['td', {}, text(2)]]],
      ]); break
      // The parser unwraps a component's single paragraph, so generate that shape.
      case 3: nodes.push(['card', { $: { syntax: 'colon', block: 1, sourceName: 'card' } }, ...inline()]); break
      default: nodes.push(['p', {}, ...inline()])
    }
  }
  return { nodes, frontmatter: {}, meta: {} }
}

// Emphasis cannot start or end with whitespace in Markdown.
const EDGE_TRIMMED_TAGS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'blockquote', 'template', 'span', 'em', 'strong', 'del'])
const EMPTY_WITHOUT_CONTENT = new Set(['p', 'li', 'ul', 'ol', 'template', 'span', 'blockquote'])

// Comark writes attributes on these native blocks as `::tag{attrs}`, which the
// parser reads as a component with the native name. Compare them as native.
const WRAPPED_NATIVE_BLOCKS = new Set(['blockquote', 'ul', 'ol', 'table', 'pre'])

const isBlockComponent = (node: MarkdownNode) => {
  const origin = node.props?.$ as { block?: number } | undefined
  return origin?.block === 1
}

// The serializer keeps an inline component's tags off their own lines by
// removing line breaks at its content edges.
const isInlineComponent = (node: MarkdownNode) => {
  const origin = node.props?.$ as { block?: number } | undefined
  return origin?.block === 0
}

/**
 * Compare meaning, not insignificant whitespace. Markdown drops whitespace at
 * block edges and before line breaks, and HTML collapses whitespace runs. The
 * parser can leave such whitespace where it removes an attribute list, as in
 * `x {.b} y`, can leave empty containers, as in `- -` or an unclosed `[`, and
 * unwraps a block component's only paragraph only when nothing else remains. Markdown cannot
 * write an empty list item or slot, and neither renders content. Code keeps
 * its exact text.
 */
const normalize = (node: MarkdownNode): MarkdownNode | undefined => {
  if (node.type !== 'element' || node.tag === 'code') return node
  if (node.tag === 'pre') {
    // A fence info string cannot carry metadata without a language, as in
    // ``` {a="b"} x```: its first word becomes the language. Compare the
    // info string without its word boundaries.
    const { language, meta, ...rest } = node.props ?? {}
    const info = `${language ?? ''}${meta ?? ''}`.replace(/\s+/g, '')
    const text = (node.children ?? []).map(child => extractMarkdownText(child)).join('')
    return { type: 'element', tag: 'pre', props: { ...rest, info }, children: [{ type: 'text', value: text }] }
  }
  const children: MarkdownNode[] = []
  for (const child of (node.children ?? []).map(normalize)) {
    if (!child) continue
    const previous = children[children.length - 1]
    if (child.type === 'text' && previous?.type === 'text') previous.value = `${previous.value}${child.value}`
    else children.push(child.type === 'text' ? { ...child } : child)
  }
  for (const [index, child] of children.entries()) {
    if (child.type !== 'text') continue
    child.value = child.value!.replace(/\s+/g, ' ')
    // Whitespace next to a hard line break does not render.
    if (children[index + 1]?.tag === 'br') child.value = child.value.trimEnd()
    if (children[index - 1]?.tag === 'br') child.value = child.value.trimStart()
  }
  if (EDGE_TRIMMED_TAGS.has(node.tag!) || isBlockComponent(node) || isInlineComponent(node)) {
    const first = children[0]
    const last = children[children.length - 1]
    if (first?.type === 'text') first.value = first.value!.trimStart()
    if (last?.type === 'text') last.value = last.value!.trimEnd()
  }
  const content = children.filter(child => child.type !== 'text' || child.value !== '')
  // A hard break at the end of a block does not render.
  if (EDGE_TRIMMED_TAGS.has(node.tag!) && content[content.length - 1]?.tag === 'br') content.pop()
  if (content.length === 0 && EMPTY_WITHOUT_CONTENT.has(node.tag!)) return undefined
  const props = { ...node.props }
  if (WRAPPED_NATIVE_BLOCKS.has(node.tag!)) delete props.$
  // Generated heading ids follow the heading text, including the whitespace
  // this comparison ignores. The focused tests cover heading ids.
  if (/^h[1-6]$/.test(node.tag!)) delete props.id
  // The parser unwraps the only paragraph of a block component.
  const only = content.length === 1 ? content[0] : undefined
  const unwrapped = isBlockComponent(node) && only?.tag === 'p' ? only.children ?? [] : content
  return { ...node, props, children: unwrapped }
}
const normalizedBody = (document: MdcDocument) =>
  projectMdcDocument(document).body.children.map(normalize).filter(Boolean)

const optionalString = { types: ['string'], required: false, allowedValues: null } as const
const POLICY: PortableComponentPolicyV2 = {
  version: 2,
  components: {
    card: { kind: 'block', props: { title: optionalString }, slots: ['footer'], allowedParents: null, allowedChildren: null, media: null },
    fire: { kind: 'inline', props: {}, slots: [], allowedParents: null, allowedChildren: null, media: null },
    badge: { kind: 'inline', props: {}, slots: [], allowedParents: null, allowedChildren: null, media: null },
  },
}

/** Parse strictly and keep only portable documents, which editors may open. */
const tryParse = async (source: string) => {
  let parsed: MdcDocument
  try {
    parsed = await parseMdcDocument(source, { autoClose: false })
  } catch {
    // Strict parsing rejects incomplete angle syntax. Those inputs are not
    // saveable documents, so they are outside the round-trip contract.
    return undefined
  }
  const body = projectMdcDocument(parsed).body
  if (!validateStoredPortableMarkdownAst(body, POLICY).ok || hasKnownParserAmbiguity(parsed.nodes)) return undefined
  return parsed
}

/**
 * Shapes whose source the parser reads differently from its own output. The
 * span bracket matcher does not skip code spans, so `[`code with ]`]` cannot
 * be written. An unclosed comment can swallow a component's closing `::`.
 * Adjacent code spans, inline text with a blank line, and an empty `id` have
 * no Markdown form; the parser produces them only from incomplete attribute
 * lists, as are fence info strings that keep `{` or `[` and attribute values
 * with line breaks. A comment that shares a line with text starts an HTML
 * block, and text directly under the root has no Markdown form. An ATX
 * heading has no line break, and Comark does not write emphasis attributes.
 * Nested empty lists and items such as `- - -` read as a thematic break.
 */
function hasKnownParserAmbiguity(nodes: unknown[]): boolean {
  const text = (node: unknown): string => typeof node === 'string' ? node : Array.isArray(node) ? node.slice(2).map(text).join('') : ''
  const visit = (node: unknown, inSpan: boolean): boolean => {
    if (typeof node === 'string') return /\n[ \t]*\n/.test(node)
    if (!Array.isArray(node)) return false
    if (node[0] === null) return /(^|\n)\s*(:|```|~~~)/.test(String(node[2] ?? ''))
    if (['li', 'ul', 'ol'].includes(String(node[0])) && node.length === 2) return true
    const props = (node[1] ?? {}) as Record<string, unknown>
    if (node[0] === 'pre') return /[{[]/.test(`${props.language ?? ''}${props.meta ?? ''}`)
    if (props.id === '') return true
    if (/^h[1-6]$/.test(String(node[0])) && JSON.stringify(node).includes('["br"')) return true
    if (['em', 'strong', 'del'].includes(String(node[0])) && Object.keys(props).length > 0) return true
    if (!props.$ && Object.values(props).some(value => typeof value === 'string' && value.includes('\n'))) return true
    if (node[0] === 'code') return inSpan && /[[\]]/.test(text(node))
    const children = node.slice(2)
    if (children.some((child, index) => Array.isArray(child) && child[0] === 'code' && Array.isArray(children[index + 1]) && (children[index + 1] as unknown[])[0] === 'code')) return true
    if (children.some(child => Array.isArray(child) && child[0] === null) && children.some(child => typeof child === 'string' && child.trim() !== '')) return true
    return children.some(child => visit(child, inSpan || node[0] === 'span'))
  }
  return nodes.some(node => (typeof node === 'string' && node.trim() !== '') || visit(node, false))
}

describe('MDC round-trip property', () => {
  it.each(SEEDS)('parse(serialize(parse(source))) equals parse(source) for seed %i', async (seed) => {
    const random = createRandom(seed)
    let checked = 0
    for (let index = 0; index < CASES_PER_SEED; index++) {
      const source = generateSource(random)
      const parsed = await tryParse(source)
      if (!parsed) continue
      checked++
      const serialized = await serializeMdcDocument(parsed)
      const context = JSON.stringify({ seed, index, source, serialized })
      const reparsed = await parseMdcDocument(serialized, { autoClose: false }).catch((error: Error) => {
        throw new Error(`${error.message} ${context}`)
      })
      expect(normalizedBody(reparsed), context).toEqual(normalizedBody(parsed))
    }
    expect(checked).toBeGreaterThan(CASES_PER_SEED / 4)
  })

  it.each(SEEDS)('parse(serialize(document)) equals the edited document for seed %i', async (seed) => {
    const random = createRandom(seed)
    for (let index = 0; index < CASES_PER_SEED; index++) {
      const document = generateDocument(random)
      const serialized = await serializeMdcDocument(document)
      const context = JSON.stringify({ seed, index, nodes: document.nodes, serialized })
      const reparsed = await parseMdcDocument(serialized, { autoClose: false }).catch((error: Error) => {
        throw new Error(`${error.message} ${context}`)
      })
      const expected = normalizedBody(document)
      const actual = normalizedBody(reparsed)
      // Generated headings carry no id; compare everything else exactly.
      const withoutHeadingIds = (value: unknown): unknown => JSON.parse(JSON.stringify(value, (key, child) =>
        key === 'props' && child && typeof child === 'object' && 'id' in child ? { ...child, id: undefined } : child))
      expect(withoutHeadingIds(actual), context).toEqual(withoutHeadingIds(expected))
    }
  })
})
