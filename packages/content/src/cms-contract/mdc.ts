/**
 * Single canonical MDC parser entry point for external CMS integrations.
 * Parse at publish time, persist the resulting AST, and return that AST from
 * the public provider instead of maintaining a second markdown parser.
 */

import { parse } from 'comark'

import type { MarkdownNode, MarkdownRoot, Toc } from '../types/content.js'
import { normalizeComarkNodes } from '../core/markdown/normalize-comark.js'
import { mapMarkdownNodes, toMarkdownRoot } from '../core/markdown/tree.js'

export interface ParseMdcBodyOptions {
  /** Maximum heading depth captured into `toc`. Default 3. */
  tocDepth?: number
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
 * Parse a raw MDC string into a normalized AST + TOC + searchable plaintext.
 *
 * The function is async because comark's parser is async (frontmatter
 * extraction, plugin pipeline). It is safe to call from a Convex mutation
 * handler — the V8 isolate supports async/await.
 */
export async function parseMdcBody(
  raw: string,
  options: ParseMdcBodyOptions = {},
): Promise<ParseMdcBodyResult> {
  const tree = await parse(raw ?? '')
  const nodes = normalizeComarkNodes(tree.nodes as unknown[], raw) as Parameters<typeof toMarkdownRoot>[0]
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
