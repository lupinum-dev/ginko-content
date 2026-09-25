/**
 * Single canonical MDC parser entry point for external CMS integrations.
 * Parse at publish time, persist the resulting AST, and return that AST from
 * the public provider instead of maintaining a second markdown parser.
 */

import { renderMarkdown } from 'comark/render'
import type { ConditionalNodeHandler, MarkdownDocument } from 'comark'
import type { MarkdownNode, MarkdownRoot, Toc } from '../types/content.js'
import { HTML_TAGS } from '../core/markdown/html-tags.js'
import { angleComponentRenderer, isAloneOnLine } from '../core/markdown/angle-components.js'
import { createHeadingIdGenerator, headingSlugText } from '../core/markdown/heading-id.js'
import { normalizeComarkNodes } from '../core/markdown/normalize-comark.js'
import { parseComark } from '../core/markdown/parse-comark.js'
import { createVerbatimHandlers, markListItemsInComponents } from '../core/markdown/serialize-handlers.js'
import { absentPrivateUseCharacter, markMdcTreeEscapes } from '../core/markdown/text-escape.js'
import { mapMarkdownNodes, toMarkdownRoot } from '../core/markdown/tree.js'

export {
  AngleComponentSyntaxError,
  type AngleComponentSyntaxIssueCode,
} from '../core/markdown/angle-syntax-error.js'
export {
  createHeadingIdGenerator,
  headingSlugText,
  slugifyHeading,
  type HeadingIdGenerator,
} from '../core/markdown/heading-id.js'

/** Parser-owned properties on an editing-document element. */
export type MdcElementProps = Record<string, unknown>

/** An element tuple: `[tag, props, ...children]`. */
export type MdcElementNode = [string, MdcElementProps, ...MdcNode[]]

/** A comment tuple: `[null, props, text]`. Comments never reach the public body. */
export type MdcCommentNode = [null, MdcElementProps, string]

/** One node of an editing document: text, element, or comment. */
export type MdcNode = string | MdcElementNode | MdcCommentNode

/**
 * The editing document that `parseMdcDocument()` returns and
 * `serializeMdcDocument()` accepts. It keeps comments and parser-origin
 * metadata (`props.$`) that the normalized public body omits.
 */
export interface MdcDocument {
  nodes: MdcNode[]
  frontmatter: Record<string, unknown>
  meta: Record<string, unknown>
}

export interface ParseMdcDocumentOptions {
  /**
   * Complete incomplete Markdown and component delimiters. Default `true`.
   * Use `false` when saving content: incomplete components then throw.
   * Completion never reads component markers inside fenced code.
   */
  autoClose?: boolean
}

export interface SerializeMdcDocumentOptions {
  /** Maximum inline component properties before YAML block syntax. Default 3. */
  maxInlineAttributes?: number
  /** Block syntax for component properties above the inline limit. Default `'codeblock'`. */
  blockAttributesStyle?: 'frontmatter' | 'codeblock'
}

/**
 * Parse source with Ginko's fixed portable profile without normalizing its
 * Comark document. Editing adapters use this boundary when comments and
 * parser-origin metadata must survive conversion.
 */
export async function parseMdcDocument(
  raw: string,
  options: ParseMdcDocumentOptions = {},
): Promise<MdcDocument> {
  return await parseComark(raw ?? '', { autoClose: options.autoClose, portable: true }) as MdcDocument
}

/**
 * Serialize an editing document while preserving its authored component syntax.
 *
 * Parsing the result with `autoClose: false` returns the same projected body:
 * text that the parser would read as MDC syntax is escaped, and a heading id
 * is written only when it differs from the id the parser generates.
 */
export async function serializeMdcDocument(
  document: MdcDocument,
  options: SerializeMdcDocumentOptions = {},
): Promise<string> {
  const renderDocument = structuredClone(document) as MarkdownDocument
  const escapeMarker = absentPrivateUseCharacter(JSON.stringify(document))
  // Component serializers clone their children, so the explicit id travels in
  // a property that no authored document can contain.
  const explicitIdKey = `${escapeMarker}id`
  markExplicitHeadingIds(renderDocument.nodes, explicitIdKey)
  separateAdjacentLists(renderDocument.nodes)
  markListItemsInComponents(renderDocument.nodes, escapeMarker)
  markMdcTreeEscapes(renderDocument.nodes, escapeMarker)
  const markdown = await renderMarkdown(renderDocument, {
    ...(options.maxInlineAttributes !== undefined ? { maxInlineAttributes: options.maxInlineAttributes } : {}),
    ...(options.blockAttributesStyle !== undefined ? { blockAttributesStyle: options.blockAttributesStyle } : {}),
    components: {
      ...createVerbatimHandlers(escapeMarker),
      angle: angleComponentRenderer,
      colonInline: colonInlineComponentRenderer,
      colonBlock: colonBlockComponentRenderer,
      explicitHeadingId: explicitHeadingIdRenderer(explicitIdKey),
    },
  })
  return markdown.split(escapeMarker).join('\\')
}

const HEADING_TAG = /^h([1-6])$/

/**
 * Markdown joins two adjacent lists of the same kind into one list, and an
 * indented nested component after a list continues its last item. An empty
 * comment between them keeps them separate; the public body omits comments.
 * Empty paragraphs, which Markdown cannot write, are removed first.
 */
function separateAdjacentLists(nodes: unknown[], offset = 0): void {
  // An empty paragraph has no Markdown form and would not separate anything.
  for (let index = nodes.length - 1; index >= offset; index--) {
    const node = nodes[index]
    if (
      Array.isArray(node) && node[0] === 'p' && Object.keys(node[1] ?? {}).length === 0 &&
      node.slice(2).every(child => typeof child === 'string' && child.trim() === '')
    ) nodes.splice(index, 1)
  }
  for (let index = nodes.length - 1; index > offset; index--) {
    const current = nodes[index]
    const previous = nodes[index - 1]
    if (!Array.isArray(current) || !Array.isArray(previous)) continue
    const adjacentLists = (current[0] === 'ul' || current[0] === 'ol') && current[0] === previous[0]
    // Comark indents nested components, and an indented line continues a list.
    const nestedComponentAfterList = offset > 0 && (previous[0] === 'ul' || previous[0] === 'ol') &&
      (current[1] as { $?: { block?: unknown } } | undefined)?.$?.block === 1
    if (adjacentLists || nestedComponentAfterList) nodes.splice(index, 0, [null, {}, ''])
  }
  for (let index = offset; index < nodes.length; index++) {
    const node = nodes[index]
    if (Array.isArray(node) && node[0] !== null) separateAdjacentLists(node, 2)
  }
}

/**
 * Mark headings whose id differs from the id the parser generates. The
 * generator runs for every heading in document order, as the parser does.
 */
function markExplicitHeadingIds(nodes: unknown[], key: string): void {
  const nextId = createHeadingIdGenerator()
  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return
    const level = typeof node[0] === 'string' ? HEADING_TAG.exec(node[0])?.[1] : undefined
    if (level && node.length > 2) {
      const generated = nextId(headingSlugText(node.slice(2)), Number(level))
      const props = node[1] as Record<string, unknown> | undefined
      if (props && typeof props.id === 'string' && props.id !== '' && props.id !== generated) {
        props[key] = props.id
      }
      return
    }
    for (const child of node.slice(2)) visit(child)
  }
  for (const node of nodes) visit(node)
}

const renderHeadingIdAttribute = (id: string): string | undefined => {
  if (/^[\w-]+$/.test(id)) return `#${id}`
  if (/[\\\r\n]/.test(id)) return undefined
  const quote = ['"', "'"].find(candidate => !id.includes(candidate))
  return quote ? `id=${quote}${id}${quote}` : undefined
}

// Comark's heading serializer always omits `id`, because the parser generates
// it. Append an explicit id only when the parser would generate another one.
const explicitHeadingIdRenderer = (key: string): ConditionalNodeHandler => ({
  match: node => typeof node[0] === 'string' && HEADING_TAG.test(node[0]) && typeof node[1]?.[key] === 'string',
  handler: async (node, state, parent) => {
    const { id: _id, [key]: explicitId, ...props } = node[1]
    const heading = [node[0], props, ...node.slice(2)] as typeof node
    const rendered = await state.handlers[node[0]]!(heading, state, parent)
    const attribute = renderHeadingIdAttribute(explicitId as string)
    const separator = state.context.blockSeparator
    if (!attribute || !rendered.endsWith(separator)) return rendered
    const line = rendered.slice(0, -separator.length)
    return Object.keys(props).length > 0 && line.endsWith('}')
      ? `${line.slice(0, -1)} ${attribute}}${separator}`
      : `${line} {${attribute}}${separator}`
  },
})

const colonMetadata = (node: unknown) => {
  if (!Array.isArray(node) || typeof node[0] !== 'string') return undefined
  const props = node[1]
  if (!props || typeof props !== 'object' || Array.isArray(props)) return undefined
  const metadata = (props as Record<string, unknown>).$
  if (
    !metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
    (metadata as Record<string, unknown>).syntax !== 'colon' ||
    ((metadata as Record<string, unknown>).block !== 0 &&
      (metadata as Record<string, unknown>).block !== 1) ||
    typeof (metadata as Record<string, unknown>).sourceName !== 'string'
  ) return undefined
  return metadata as { syntax: 'colon'; block: 0 | 1; sourceName: string }
}

const renderColonProps = (props: Record<string, unknown>): string | undefined => {
  const entries = Object.entries(props).filter(([name]) => name !== '$')
  if (entries.length === 0) return ''
  const rendered: string[] = []
  for (const [name, value] of entries) {
    // Bound colon properties do not share angle syntax's typed JSON contract.
    if (typeof value !== 'string') return undefined
    const text = value
    if (/[\\\r\n]/.test(text)) return undefined
    // Colon attributes do not unescape quoted values. Choose an absent
    // delimiter, or let the angle renderer encode the complete component.
    const quote = ['"', "'", '`'].find(candidate => !text.includes(candidate))
    if (!quote) return undefined
    rendered.push(`${name}=${quote}${text}${quote}`)
  }
  return `{${rendered.join(' ')}}`
}

const colonInlineComponentRenderer: ConditionalNodeHandler = {
  match: node => colonMetadata(node)?.block === 0,
  handler: async (node, state, parent) => {
    const metadata = colonMetadata(node)
    if (!metadata) return ''
    const props = renderColonProps(node[1])
    // Colon syntax also needs a separator before `:`; angle syntax does not.
    // A colon component alone in a paragraph would read as block shorthand.
    if (props === undefined || !followsComponentPrefix(node, parent) || isAloneInParagraph(node, parent)) {
      const angleNode = structuredClone(node)
      // Capitalization also distinguishes components named after native HTML
      // elements. The canonical component name remains unchanged.
      const angleMetadata = { ...metadata, syntax: 'angle', sourceName: metadata.sourceName[0]!.toUpperCase() + metadata.sourceName.slice(1) }
      angleNode[1].$ = angleMetadata
      const angleParent = parent?.map(child => child === node ? angleNode : child) as typeof parent
      return angleComponentRenderer.handler(angleNode, state, angleParent)
    }
    const rendered = node.length === 2
      ? `:${metadata.sourceName}${props || (precedesSpanOnLine(node, parent) || precedesNameCharacter(node, parent) ? '{}' : '')}`
      : `:${metadata.sourceName}[${await state.flow(node, state)}]${props}`
    // A shorthand component that stands alone between blocks needs its own line.
    return isBlockLevel(parent) ? `${rendered}${state.context.blockSeparator}` : rendered
  },
}

// Characters after which the parser accepts an inline `:name` component.
const COMPONENT_PREFIX = new Set([' ', '\t', '\n', '*', '_', '['])
// Inline elements whose Markdown ends with an accepted prefix character.
const PREFIX_ENDING_ELEMENTS = new Set(['strong', 'em', 'br'])

const followsComponentPrefix = (node: unknown[], parent: unknown[] | undefined): boolean => {
  if (!parent) return true
  let index = parent.indexOf(node) - 1
  while (index >= 2 && parent[index] === '') index--
  // The first child follows its container's own syntax, such as `- `, `**`, or `[`.
  if (index < 2) return true
  const previous = parent[index]
  if (typeof previous === 'string') return COMPONENT_PREFIX.has(previous[previous.length - 1]!)
  return Array.isArray(previous) && PREFIX_ENDING_ELEMENTS.has(previous[0])
}

// Block shorthand starts a block, so only the first line of a text run is at
// risk: a paragraph, or the unwrapped paragraph of a list item or component.
const isAloneInParagraph = (node: unknown[], parent: unknown[] | undefined): boolean => {
  if (!parent || !isAloneOnLine(node, parent)) return false
  if (typeof parent[0] === 'string' && /^(h[1-6]|td|th)$/.test(parent[0])) return false
  const children = parent.slice(2)
  const textRun = parent[0] === 'p' || children.some(child => typeof child === 'string' && child.trim() !== '')
  return textRun && children.slice(0, children.indexOf(node)).every(child => typeof child === 'string' && child.trim() === '')
}

const isBlockLevel = (parent: unknown[] | undefined): boolean => {
  if (!parent) return true
  const props = parent[1]
  const metadata = props && typeof props === 'object' ? (props as { $?: { block?: unknown } }).$ : undefined
  // The block renderer below passes components without their `$` metadata.
  const blockComponent = parent[0] === 'template' || metadata?.block === 1 ||
    (metadata === undefined && typeof parent[0] === 'string' && !HTML_TAGS.has(parent[0]))
  return blockComponent && !parent.slice(2).some(child => typeof child === 'string' || isInlineElement(child))
}

const INLINE_ELEMENT_TAGS = new Set(['a', 'br', 'code', 'del', 'em', 'img', 'span', 'strong'])

const isInlineElement = (node: unknown): boolean => {
  if (!Array.isArray(node) || typeof node[0] !== 'string') return false
  const origin = (node[1] as { $?: { block?: unknown } } | undefined)?.$
  return origin ? origin.block === 0 && colonMetadata(node) === undefined : INLINE_ELEMENT_TAGS.has(node[0])
}

// Text such as `beta` directly after `:fire` would extend the component name.
const precedesNameCharacter = (node: unknown[], parent: unknown[] | undefined): boolean => {
  if (!parent) return false
  const next = parent[parent.indexOf(node) + 1]
  return typeof next === 'string' && /^[\w$-]/.test(next)
}

// `:name [text]` alone on a line is block shorthand with content. Empty props
// keep a following span separate.
const precedesSpanOnLine = (node: unknown[], parent: unknown[] | undefined): boolean => {
  if (!parent) return false
  const index = parent.indexOf(node)
  let next = parent[index + 1]
  if (typeof next === 'string' && next.trim() === '' && !next.includes('\n')) next = parent[index + 2]
  return Array.isArray(next) && next[0] === 'span'
}

// Dispatch parser-marked blocks directly to the component serializer. Native
// handlers would otherwise turn components such as img into Markdown images.
const colonBlockComponentRenderer: ConditionalNodeHandler = {
  match: node => colonMetadata(node)?.block === 1,
  handler: async (node, state, parent) => {
    const metadata = colonMetadata(node)!
    const component = structuredClone(node)
    // Comark's component serializer also special-cases span and table. An
    // uppercase authored name preserves colon syntax and the canonical identity.
    component[0] = HTML_TAGS.has(node[0])
      ? metadata.sourceName[0]!.toUpperCase() + metadata.sourceName.slice(1)
      : metadata.sourceName
    delete component[1].$
    return state.handlers.mdc!(component, state, parent)
  },
}

export interface ParseMdcBodyOptions {
  /** Maximum heading depth captured into `toc`. Default 3. */
  tocDepth?: number
  /**
   * Complete incomplete component delimiters. Default `true`. Completion never
   * reads component markers inside fenced code.
   */
  autoClose?: boolean
}

export interface ParseMdcBodyResult {
  /** Normalized MDC AST root. The public provider serves this verbatim. */
  body: MarkdownRoot
  /** Table-of-contents extracted from headings in the parsed AST (NOT regex). */
  toc: Toc | undefined
  /** Plain text rendering of the body, for search indexing. */
  searchText: string
}

/**
 * Parse a raw MDC string with Ginko's fixed portable-baseline profile into a
 * normalized AST + TOC + searchable plaintext. Site-configured filesystem
 * plugins are intentionally not applied at this CMS publishing boundary.
 *
 * The function is async because comark's parser is async (frontmatter
 * extraction, plugin pipeline). It is safe to call from a Convex mutation
 * handler — the V8 isolate supports async/await.
 */
export async function parseMdcBody(
  raw: string,
  options: ParseMdcBodyOptions = {},
): Promise<ParseMdcBodyResult> {
  const tree = await parseMdcDocument(raw, { autoClose: options.autoClose })
  return projectMdcDocument(tree, options)
}

/** Derive public body/search projections without modifying the editing document. */
export function projectMdcDocument(
  document: MdcDocument,
  options: Pick<ParseMdcBodyOptions, 'tocDepth'> = {},
): ParseMdcBodyResult {
  const nodes = normalizeComarkNodes(structuredClone(document.nodes) as unknown[])
  const toc = deriveToc(nodes, options)
  const body = toMarkdownRoot(nodes, toc)
  const searchText = renderPlainText(body)
  return { body, toc, searchText }
}

function deriveToc(
  nodes: Parameters<typeof toMarkdownRoot>[0],
  options: ParseMdcBodyOptions,
): Toc | undefined {
  const searchDepth = options.tocDepth ?? 3
  const links = []
  const nextId = createHeadingIdGenerator()
  for (const node of nodes) {
    if (!Array.isArray(node)) continue
    const tag = String(node[0] ?? '')
    const match = HEADING_TAG.exec(tag)
    if (!match) continue
    const depth = Number(match[1])
    const props = node[1] && typeof node[1] === 'object' ? node[1] : {}
    const children = node.slice(2) as unknown[]
    // Advance the parser's id sequence for every top-level heading.
    const generatedId = nextId(headingSlugText(children), depth)
    if (depth < 2 || depth > searchDepth) continue
    const text = collectTupleText(children)
    links.push({
      id: String((props as Record<string, unknown>).id || generatedId),
      text,
      depth,
    })
  }
  return links.length > 0 ? { title: '', depth: 2, searchDepth, links } : undefined
}

function collectTupleText(nodes: unknown[]): string {
  let value = ''
  for (const node of nodes) {
    if (typeof node === 'string') {
      value += node
    } else if (Array.isArray(node)) {
      value += collectTupleText(node.slice(2))
    }
  }
  return value.trim()
}

function renderPlainText(root: MarkdownRoot): string {
  const parts: string[] = []
  mapMarkdownNodes(root.children, (node: MarkdownNode) => {
    if (node.type === 'text' && typeof node.value === 'string') parts.push(node.value)
    return node
  })
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
