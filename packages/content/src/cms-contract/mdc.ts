/**
 * Single canonical MDC parser entry point for external CMS integrations.
 * Parse at publish time, persist the resulting AST, and return that AST from
 * the public provider instead of maintaining a second markdown parser.
 */

import { renderFrontmatter, renderMarkdown } from 'comark/render'
import type { ConditionalNodeHandler, MarkdownDocument } from 'comark'
import type { MarkdownNode, MarkdownRoot, Toc } from '../types/content.js'
import { HTML_TAGS } from '../core/markdown/html-tags.js'
import { angleComponentRenderer, isAloneOnLine } from '../core/markdown/angle-components.js'
import { createHeadingIdGenerator, headingSlugText } from '../core/markdown/heading-id.js'
import { normalizeComarkNodes } from '../core/markdown/normalize-comark.js'
import { parseComark, readsAsJson } from '../core/markdown/parse-comark.js'
import { createVerbatimHandlers, markHeadingBreaks, markListItemsInComponents } from '../core/markdown/serialize-handlers.js'
import { absentPrivateUseCharacters, markMdcTreeEscapes } from '../core/markdown/text-escape.js'
import { mapMarkdownNodes, toMarkdownRoot } from '../core/markdown/tree.js'
import { MdcSerializationError } from '../core/markdown/serialization-error.js'

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

export { MdcSerializationError, type MdcSerializationIssueCode } from '../core/markdown/serialization-error.js'

// Tags that Comark serializes with a native Markdown handler. An element
// without origin metadata whose tag is neither one of these nor an HTML
// element, such as `note`, is written as a colon component.
const NATIVE_SERIALIZER_TAGS = new Set([
  'code', 'pre', 'hr', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'a', 'ul', 'ol', 'li', 'html', 'strong',
  'em', 'blockquote', 'img', 'del', 'template', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'comment', 'math',
  'mermaid',
])

/**
 * Give colon metadata to components without origin metadata, in place, so the
 * colon serializers write them instead of Comark's unescaped fallback.
 */
function markImplicitComponents(nodes: unknown[]): void {
  const visit = (node: unknown) => {
    if (!Array.isArray(node) || typeof node[0] !== 'string') return
    const props = node[1] as Record<string, unknown> | undefined
    const origin = props?.$ as Record<string, unknown> | undefined
    if (
      props && !NATIVE_SERIALIZER_TAGS.has(node[0]) && !HTML_TAGS.has(node[0]) && origin?.html !== 1 &&
      origin?.syntax !== 'colon' && origin?.syntax !== 'angle'
    ) {
      props.$ = { syntax: 'colon', block: origin?.block === 0 ? 0 : 1, sourceName: node[0] }
    }
    for (const child of node.slice(2)) visit(child)
  }
  for (const node of nodes) visit(node)
}

// Property names that each attribute syntax reads back unchanged. A colon
// block component writes any other name in its YAML block.
const COLON_NAME = /^:?[A-Z_][\w-]*$/i
// `{--accent="red"}` is the legacy CSS custom property spelling.
const INLINE_ATTRIBUTE_NAME = /^(?::?[A-Z_][\w-]*|--[A-Z][\w-]*)$/i
const ANGLE_NAME = /^[A-Z_][\w.-]*$/i
const isAngleName = (name: string) =>
  ANGLE_NAME.test(name) && !name.startsWith('v-') && !['__proto__', 'prototype', 'constructor'].includes(name)

/** Remove properties whose value is `undefined`, which no syntax can write. */
function dropUndefinedProps(nodes: unknown[]): void {
  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return
    const props = node[1] as Record<string, unknown> | undefined
    if (props && typeof props === 'object') {
      for (const [name, value] of Object.entries(props)) {
        if (value === undefined) Reflect.deleteProperty(props, name)
      }
    }
    for (const child of node.slice(2)) visit(child)
  }
  for (const node of nodes) visit(node)
}

// Properties that native Markdown writes in its own syntax rather than in a
// `{...}` attribute list, where Comark reads `"[1]"` as JSON.
const MARKDOWN_SYNTAX_PROPS: Record<string, ReadonlySet<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title']),
  ol: new Set(['start']),
  ...Object.fromEntries(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].map(tag => [tag, new Set(['id'])])),
}
// Elements whose properties are all written in Markdown syntax.
const MARKDOWN_SYNTAX_TAGS = new Set(['pre', 'code', 'input', 'math', 'mermaid', 'td', 'th', 'template'])

/**
 * Throw for a property string that the parser reads as JSON, such as `"[1]"`,
 * in the `{...}` attribute list of a native Markdown element, where no syntax
 * keeps it a string. Components write such strings in a YAML block or in
 * angle syntax, and HTML attributes stay strings.
 */
const assertRepresentable = (nodes: unknown[]): void => {
  const visit = (node: unknown, path: Array<string | number>) => {
    if (!Array.isArray(node) || typeof node[0] !== 'string') return
    const tag = node[0]
    const props = (node[1] ?? {}) as Record<string, unknown>
    const origin = props.$ as { syntax?: unknown, html?: unknown } | undefined
    const native = origin?.html !== 1 && origin?.syntax !== 'colon' && origin?.syntax !== 'angle' && !MARKDOWN_SYNTAX_TAGS.has(tag)
    const fail = (name: string, reason: string) => {
      throw new MdcSerializationError('unrepresentable_value', `Element "${tag}" property "${name}" ${reason}.`, [...path, 1, name])
    }
    for (const [name, value] of Object.entries(props)) {
      if (name === '$') continue
      if (origin?.syntax === 'angle' && !isAngleName(name)) fail(name, 'is not a valid angle-syntax property name')
      if (!native || MARKDOWN_SYNTAX_PROPS[tag]?.has(name)) continue
      if (!INLINE_ATTRIBUTE_NAME.test(name) || name.startsWith(':')) fail(name, 'is not a valid attribute name')
      if (readsAsJson(value)) fail(name, 'is a string that Markdown reads back as JSON')
    }
    node.slice(2).forEach((child, index) => visit(child, [...path, index + 2]))
  }
  nodes.forEach((node, index) => visit(node, [index]))
}

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
 * is written only when it differs from the id the parser generates. Throws
 * `MdcSerializationError` instead of writing a value that would read back
 * differently: a property string that is a JSON object or array, such as
 * `"[1, 2]"`, in the `{...}` attribute list of a native Markdown element.
 */
export async function serializeMdcDocument(
  document: MdcDocument,
  options: SerializeMdcDocumentOptions = {},
): Promise<string> {
  const renderDocument = structuredClone(document) as MarkdownDocument
  dropUndefinedProps(renderDocument.nodes)
  markImplicitComponents(renderDocument.nodes)
  // Checked before any pass inserts nodes, so paths match `document.nodes`.
  assertRepresentable(renderDocument.nodes)
  const [escapeMarker, ltMarker, ampMarker] = absentPrivateUseCharacters(JSON.stringify(document), 3) as [string, string, string]
  const markers = { escape: escapeMarker, lt: ltMarker, amp: ampMarker }
  // Component serializers clone their children, so the explicit id travels in
  // a property that no authored document can contain.
  const explicitIdKey = `${escapeMarker}id`
  markExplicitHeadingIds(renderDocument.nodes, explicitIdKey)
  separateAdjacentLists(renderDocument.nodes)
  markListItemsInComponents(renderDocument.nodes, escapeMarker)
  markHeadingBreaks(renderDocument.nodes, escapeMarker)
  markMdcTreeEscapes(renderDocument.nodes, markers)
  const markdown = await renderMarkdown(renderDocument, {
    ...(options.maxInlineAttributes !== undefined ? { maxInlineAttributes: options.maxInlineAttributes } : {}),
    ...(options.blockAttributesStyle !== undefined ? { blockAttributesStyle: options.blockAttributesStyle } : {}),
    components: {
      ...createVerbatimHandlers(escapeMarker, markers),
      angle: angleComponentRenderer,
      colonInline: colonInlineComponentRenderer,
      colonBlock: createColonBlockComponentRenderer(options),
      explicitHeadingId: explicitHeadingIdRenderer(explicitIdKey),
    },
  })
  return markdown.split(escapeMarker).join('\\').split(ltMarker).join('<').split(ampMarker).join('&')
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
  if (/[\\\r\n\u2028\u2029]/.test(id)) return undefined
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
    // A `:name` key is a colon binding that the parser keeps under that name,
    // with a string or JSON value. Angle syntax has no such key.
    if (!INLINE_ATTRIBUTE_NAME.test(name)) return undefined
    const binding = name.startsWith(':')
    // Comark reads an inline string such as `"[1]"` as JSON; angle syntax
    // keeps it. Other typed values use angle syntax's JSON bindings.
    if (!binding && (typeof value !== 'string' || readsAsJson(value))) return undefined
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    if (/[\\\r\n\u2028\u2029]/.test(text)) return undefined
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
      const name = Object.keys(node[1]).find(key => key !== '$' && !isAngleName(key))
      if (name !== undefined) {
        throw new MdcSerializationError('unrepresentable_value', `Component "${node[0]}" property "${name}" has no inline form here.`, [])
      }
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
// Shorthand takes the whole line, or `[content]` and `{props}` after spaces.
const isAloneInParagraph = (node: unknown[], parent: unknown[] | undefined): boolean => {
  if (!parent) return false
  if (typeof parent[0] === 'string' && /^(h[1-6]|td|th)$/.test(parent[0])) return false
  const children = parent.slice(2)
  const index = children.indexOf(node)
  const textRun = parent[0] === 'p' || children.some(child => typeof child === 'string' && child.trim() !== '')
  if (!textRun || !children.slice(0, index).every(child => typeof child === 'string' && child.trim() === '')) return false
  if (isAloneOnLine(node, parent)) return true
  let next = children[index + 1]
  if (typeof next === 'string' && /^[ \t]*$/.test(next)) next = children[index + 2]
  if (typeof next === 'string') return /^[ \t]*[{[]/.test(next)
  return Array.isArray(next) && (next[0] === 'a' || next[0] === 'span')
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

// Text such as `beta` directly after `:fire` would extend the component name,
// and `{{` would read as its properties.
const precedesNameCharacter = (node: unknown[], parent: unknown[] | undefined): boolean => {
  if (!parent) return false
  const next = parent[parent.indexOf(node) + 1]
  // `{` directly after the name would open its property list, and a link or
  // span (`[...]`) would become its content.
  if (Array.isArray(next)) return (next[0] === 'a' || next[0] === 'span') && !colonMetadata(next)
  return typeof next === 'string' && /^[\w${-]/.test(next)
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
/** Whether a string, key, or nested value contains a line break. */
const hasLineBreak = (value: unknown): boolean => {
  if (typeof value === 'string') return /[\r\n\u2028\u2029]/.test(value)
  if (Array.isArray(value)) return value.some(hasLineBreak)
  return value !== null && typeof value === 'object' &&
    Object.entries(value).some(([key, child]) => hasLineBreak(key) || hasLineBreak(child))
}

/**
 * Inline colon attributes are always strings, and Comark writes them in double
 * quotes without escaping. Comark's own YAML block turns the strings `"true"`
 * and `"false"` into booleans. A component that needs a YAML block, because
 * of `maxInlineAttributes` or a number, boolean, null, array, or object
 * property, or a string with `"`, `\`, or a line break, gets one written here.
 * Every value stays on its key line, so no line can start with `::` or
 * `---`, and the parser reads the exact JSON values.
 */
const createColonBlockComponentRenderer = (options: SerializeMdcDocumentOptions): ConditionalNodeHandler => ({
  match: node => colonMetadata(node)?.block === 1,
  handler: async (node, state, parent) => {
    const metadata = colonMetadata(node)!
    const component = structuredClone(node)
    // Comark's component serializer special-cases span and table. An
    // uppercase authored name preserves colon syntax and the canonical identity.
    component[0] = node[0] === 'span' || node[0] === 'table'
      ? metadata.sourceName[0]!.toUpperCase() + metadata.sourceName.slice(1)
      : metadata.sourceName
    delete component[1].$
    const props = component[1]
    const entries = Object.entries(props)
    const style = options.blockAttributesStyle ?? 'codeblock'
    const maxInline = options.maxInlineAttributes ?? 3
    // Comark reads an inline string such as `"[1, 2]"` as JSON.
    const needsYaml = maxInline === 0 || entries.length > maxInline || entries.some(([name, value]) => !COLON_NAME.test(name) ||
      (!name.startsWith(':') && (typeof value !== 'string' || /["\\\r\n\u2028\u2029]/.test(value) || readsAsJson(value))))
    // Nested components restore the caller's settings for themselves.
    const revert = state.applyContext({ blockAttributesStyle: style, maxInlineAttributes: maxInline })
    try {
      // Comark indents a component inside any parent. In a blockquote that
      // indentation adds to the quote's own, and a nested component would
      // reach four spaces and read as indented code.
      const writeComponent = async () => {
        const text = await state.handlers.mdc!(component, state, parent)
        return parent?.[0] === 'blockquote' && /^ {2}::/.test(text)
          ? text.split('\n').map(line => line.startsWith('  ') ? line.slice(2) : line).join('\n')
          : text
      }
      if (!needsYaml) return await writeComponent()
      component[1] = {}
      // Without properties, Comark would otherwise write an empty YAML block.
      state.applyContext({ maxInlineAttributes: Number.MAX_SAFE_INTEGER })
      const rendered = await writeComponent()
      // Next to text or inside a link or emphasis, Comark writes the inline
      // form, which has no property block. Write the inline component instead;
      // it encodes such values as angle-syntax attributes.
      if (!/^[ \t]*::/.test(rendered)) {
        state.applyContext({ maxInlineAttributes: maxInline })
        const inlineNode = structuredClone(node)
        inlineNode[1].$ = { ...metadata, block: 0 }
        const inlineParent = parent?.map(child => child === node ? inlineNode : child) as typeof parent
        return await colonInlineComponentRenderer.handler(inlineNode, state, inlineParent)
      }
      const lines = rendered.split('\n')
      // Nested components carry their own indentation on every line.
      const indentation = /^[ \t]*/.exec(lines[0]!)![0]
      // A multi-line string would become a block scalar, whose lines could
      // start with `::` or `---`. Double quotes keep it on its key line.
      const yaml = renderFrontmatter(props, '', { forceQuotes: hasLineBreak(props), quotingType: '"', flowLevel: 1 }).split('\n')
      // Only the `---` form keeps number, boolean, null, array, and object
      // types, and strings that read as JSON.
      const typed = entries.some(([, value]) => typeof value !== 'string' || readsAsJson(value))
      const fence = style === 'frontmatter' || typed ? ['---', '---'] : ['```yaml [props]', '```']
      lines.splice(1, 0, ...[fence[0]!, ...yaml, fence[1]!].map(line => `${indentation}${line}`))
      return lines.join('\n')
    } finally {
      state.applyContext(revert)
    }
  },
})

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
