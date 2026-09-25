import { autoCloseMarkdown } from 'comark'
import { absentPrivateUseCharacter } from './text-escape.js'

const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/

/**
 * Line indexes whose content Markdown treats as literal text: fenced code and a
 * leading YAML frontmatter block. Component markers on these lines are not
 * syntax, so completion must not count them.
 */
const literalLineIndexes = (lines: readonly string[]): Set<number> => {
  const literal = new Set<number>()
  let index = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, candidate) => candidate > 0 && line.trim() === '---')
    if (end > 0) {
      for (let candidate = 0; candidate <= end; candidate++) literal.add(candidate)
      index = end + 1
    }
  }
  let fence: { marker: string, length: number } | undefined
  for (; index < lines.length; index++) {
    const trimmed = lines[index]!.trimStart()
    if (fence) {
      literal.add(index)
      const run = /^(`+|~+)[ \t]*$/.exec(trimmed)?.[1]
      if (run && run[0] === fence.marker && run.length >= fence.length) fence = undefined
      continue
    }
    const opening = FENCE_OPEN.exec(trimmed)
    // CommonMark does not allow a backtick in a backtick fence's info string.
    if (!opening || (opening[1]![0] === '`' && opening[2]!.includes('`'))) continue
    literal.add(index)
    fence = { marker: opening[1]![0]!, length: opening[1]!.length }
  }
  return literal
}

/**
 * Complete unfinished Markdown and component delimiters without reading code.
 *
 * Comark's completion counts `::name` lines everywhere, so a component marker
 * inside a fenced code block receives a closing `::` after the fence. This
 * wrapper hides literal lines and escaped braces from completion and restores
 * them afterward. Completion only rewrites the final line, the trailing table,
 * and appended closers; hidden lines keep their original index.
 */
export const autoCloseMarkdownOutsideCode = (markdown: string): string => {
  if (!markdown) return markdown
  const placeholder = absentPrivateUseCharacter(markdown)
  const lines = markdown.split('\\{').join(`\\${placeholder}`).split('\n')
  const literal = literalLineIndexes(lines)
  const masked = lines.map((line, index) => literal.has(index) ? '' : line)
  const completed = autoCloseMarkdown(masked.join('\n'), { syntax: true }).split('\n')
  for (const index of literal) completed[index] = lines[index]!
  return completed.join('\n').split(`\\${placeholder}`).join('\\{')
}
