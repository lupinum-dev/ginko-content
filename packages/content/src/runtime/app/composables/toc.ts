import type { Toc, TocLink } from '../../../types/content'

export type { Toc, TocLink }

export interface ContentTocOptions {
  depth?: number
  title?: string
  searchDepth?: number
}

function slugHeading (value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

export function extractContentToc (
  content: string,
  options: ContentTocOptions = {}
): Toc {
  const maxDepth = options.depth ?? 4
  const links: TocLink[] = []
  const headingRegex = /^(#{2,4})\s+(\S.*)$/gm
  let match: RegExpExecArray | null = headingRegex.exec(content)

  while (match !== null) {
    const depth = match[1]!.length
    const text = match[2]!.trim()
    if (depth <= maxDepth) {
      links.push({ id: slugHeading(text), text, depth })
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
