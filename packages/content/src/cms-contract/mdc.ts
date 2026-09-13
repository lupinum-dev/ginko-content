/**
 * Single canonical MDC parser entry point for external CMS integrations.
 * Parse at publish time, persist the resulting AST, and return that AST from
 * the public provider instead of maintaining a second markdown parser.
 */

import { renderMarkdown } from 'comark/render'
import type { ConditionalNodeHandler, MarkdownDocument } from 'comark'
import type { RenderMarkdownOptions } from 'comark/render'
import type { MarkdownNode, MarkdownRoot, Toc } from '../types/content.js'
import { HTML_TAGS } from '../core/markdown/html-tags.js'
import { angleComponentRenderer } from '../core/markdown/angle-components.js'
import { normalizeComarkNodes } from '../core/markdown/normalize-comark.js'
import { parseComark, type ParseComarkOptions } from '../core/markdown/parse-comark.js'
import { mapMarkdownNodes, toMarkdownRoot } from '../core/markdown/tree.js'

export type ParseMdcDocumentOptions = ParseComarkOptions

/**
 * Parse source with Ginko's fixed portable profile without normalizing its
 * Comark document. Editing adapters use this boundary when comments and
 * parser-origin metadata must survive conversion.
 */
export async function parseMdcDocument(
  raw: string,
  options: ParseMdcDocumentOptions = {},
) {
  return await parseComark(raw ?? '', options)
}

/** Serialize an editing document while preserving its authored component syntax. */
export async function serializeMdcDocument(
  document: MarkdownDocument,
  options: RenderMarkdownOptions = {},
): Promise<string> {
  const renderDocument = structuredClone(document)
  return await renderMarkdown(renderDocument, {
    ...options,
    components: {
      ...options.components,
      angle: angleComponentRenderer,
      colonInline: colonInlineComponentRenderer,
      colonBlock: colonBlockComponentRenderer,
    },
  })
}

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
  handler: async (node, state) => {
    const metadata = colonMetadata(node)
    if (!metadata) return ''
    const props = renderColonProps(node[1])
    if (props === undefined) {
      const angleNode = structuredClone(node)
      // Capitalization also distinguishes components named after native HTML
      // elements. The canonical component name remains unchanged.
      const angleMetadata = { ...metadata, syntax: 'angle', sourceName: metadata.sourceName[0]!.toUpperCase() + metadata.sourceName.slice(1) }
      angleNode[1].$ = angleMetadata
      return angleComponentRenderer.handler(angleNode, state)
    }
    if (node.length === 2) return `:${metadata.sourceName}${props}`
    return `:${metadata.sourceName}[${await state.flow(node, state)}]${props}`
  },
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
  /** Complete incomplete component delimiters. Default `true`. */
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
  document: MarkdownDocument,
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
  for (const node of nodes) {
    if (!Array.isArray(node)) continue
    const tag = String(node[0] ?? '')
    const match = /^h([1-6])$/.exec(tag)
    if (!match) continue
    const depth = Number(match[1])
    if (depth < 2 || depth > searchDepth) continue
    const props = node[1] && typeof node[1] === 'object' ? node[1] : {}
    const children = node.slice(2) as unknown[]
    const text = collectTupleText(children)
    links.push({
      id: String((props as Record<string, unknown>).id || slugHeading(text)),
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

function slugHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

function renderPlainText(root: MarkdownRoot): string {
  const parts: string[] = []
  mapMarkdownNodes(root.children, (node: MarkdownNode) => {
    if (node.type === 'text' && typeof node.value === 'string') parts.push(node.value)
    return node
  })
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}
