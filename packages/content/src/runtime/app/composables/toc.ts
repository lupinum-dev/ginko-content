import type { Toc, TocLink } from '../../../types/content'
import { createHeadingIdGenerator } from '../../../core/markdown/heading-id'

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
  // Every heading level advances the parser's id sequence, so match all six.
  const headingRegex = /^(#{1,6})\s+(\S.*)$/gm
  const nextId = createHeadingIdGenerator()
  let match: RegExpExecArray | null = headingRegex.exec(content)

  while (match !== null) {
    const depth = match[1]!.length
    const text = match[2]!.trim()
    const id = nextId(text, depth)
    if (depth >= 2 && depth <= maxDepth) {
      links.push({ id, text, depth })
    }
    match = headingRegex.exec(content)
  }

  return {
    title: options.title ?? '',
    depth: 2,
    searchDepth: options.searchDepth ?? maxDepth,
    links
  }
}
