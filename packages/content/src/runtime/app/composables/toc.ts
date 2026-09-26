import type { Toc, TocLink } from '../../../types/content'
import { createHeadingIdGenerator } from '../../../core/markdown/heading-id'
import { scanLiteralLines } from '../../../core/markdown/auto-close'

export type { Toc, TocLink }

export interface ContentTocOptions {
  depth?: number
  title?: string
  searchDepth?: number
}

/**
 * Derive a table of contents from Markdown source. Link ids follow the MDC
 * parser's heading ids, including parent prefixes and duplicate suffixes, for
 * headings that contain plain text.
 */
export function extractContentToc (
  content: string,
  options: ContentTocOptions = {}
): Toc {
  const maxDepth = options.depth ?? 4
  const links: TocLink[] = []
  const lines = content.split(/\r?\n/)
  // Headings inside fenced code or frontmatter are not headings.
  const { literal } = scanLiteralLines(lines)
  const nextId = createHeadingIdGenerator()

  for (const [index, line] of lines.entries()) {
    // Every heading level advances the parser's id sequence, so match all six.
    // CommonMark allows up to three spaces before a heading marker.
    const match = literal.has(index) ? null : /^ {0,3}(#{1,6})\s+(\S.*)$/.exec(line)
    if (!match) continue
    const depth = match[1]!.length
    const text = match[2]!.trim()
    const id = nextId(text, depth)
    if (depth >= 2 && depth <= maxDepth) {
      links.push({ id, text, depth })
    }
  }

  return {
    title: options.title ?? '',
    depth: 2,
    searchDepth: options.searchDepth ?? maxDepth,
    links
  }
}
