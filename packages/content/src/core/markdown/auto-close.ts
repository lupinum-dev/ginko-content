import { autoCloseMarkdown } from 'comark'
import { absentPrivateUseCharacter } from './text-escape.js'

const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/
const QUOTE_PREFIX = /^ {0,3}> ?/
const LIST_MARKER = /^( {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+)/

interface OpenFence {
  marker: string
  length: number
  /** Container prefix of the opening line, reused for a completed closer. */
  prefix: string
}

/**
 * Literal line indexes and any fence left open at the end: fenced code and a
 * leading YAML frontmatter block, and indented code. Component markers and
 * headings on these lines are not syntax.
 *
 * A fence may follow blockquote and list-item markers. It opens with at most
 * three spaces of indentation relative to the enclosing list item, so
 * indented code is not read as a fence.
 */
export const scanLiteralLines = (lines: readonly string[]): { literal: Set<number>, open?: OpenFence } => {
  const literal = new Set<number>()
  let index = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, candidate) => candidate > 0 && line.trim() === '---')
    if (end > 0) {
      for (let candidate = 0; candidate <= end; candidate++) literal.add(candidate)
      index = end + 1
    }
  }
  let fence: OpenFence | undefined
  // Content column of the innermost list item that the current line continues.
  let listIndent = 0
  // Indented code starts after a blank line and continues through blank lines.
  let previousBlank = true
  let indentedCode = false
  for (; index < lines.length; index++) {
    let line = lines[index]!
    let prefix = ''
    for (let match = QUOTE_PREFIX.exec(line); match; match = QUOTE_PREFIX.exec(line)) {
      prefix += match[0]
      line = line.slice(match[0].length)
    }
    if (fence) {
      literal.add(index)
      const run = /^(`+|~+)[ \t]*$/.exec(line.trimStart())?.[1]
      if (run && run[0] === fence.marker && run.length >= fence.length) {
        fence = undefined
        previousBlank = true
      }
      continue
    }
    if (!line.trim()) {
      previousBlank = true
      continue
    }
    const blankBefore = previousBlank
    // A component marker or ATX heading line ends any paragraph, so indented
    // code can start on the next line.
    previousBlank = /^\s*(?::{2,}|#{1,6}(?:\s|$))/.test(line)
    const marker = LIST_MARKER.exec(line)?.[1]
    if (marker) {
      listIndent = prefix.length + marker.length
      prefix += ' '.repeat(marker.length)
      line = line.slice(marker.length)
    } else {
      const indent = line.length - line.trimStart().length
      if (indent < listIndent) listIndent = 0
      const relative = indent - Math.min(indent, listIndent)
      if (relative > 3) {
        // An indented line cannot interrupt a paragraph.
        if (blankBefore || indentedCode) {
          indentedCode = true
          literal.add(index)
        }
        continue
      }
      prefix += line.slice(0, indent)
      line = line.slice(indent)
    }
    indentedCode = false
    const opening = FENCE_OPEN.exec(line)
    // CommonMark does not allow a backtick in a backtick fence's info string.
    if (!opening || (opening[1]![0] === '`' && opening[2]!.includes('`'))) continue
    literal.add(index)
    fence = { marker: opening[1]![0]!, length: opening[1]!.length, prefix: prefix.replace(/[^ >]/g, ' ') }
  }
  return { literal, open: fence }
}

/**
 * Hide `\{` from completion, which would otherwise close it as an attribute
 * list. A brace after an escaped backslash (`\\{`) stays visible.
 */
const maskEscapedBraces = (markdown: string, placeholder: string) =>
  markdown.replace(/(\\+)\{/g, (match, slashes: string) => slashes.length % 2 === 1 ? `${slashes}${placeholder}` : match)

/**
 * Complete unfinished Markdown and component delimiters without reading code.
 *
 * Comark's completion counts `::name` lines everywhere, so a component marker
 * inside a fenced code block receives a closing `::` after the fence. This
 * wrapper hides literal lines and escaped braces from completion and restores
 * them afterward. Completion only rewrites the final line, the trailing table,
 * and appended closers; hidden lines keep their original index. A fence left
 * open at the end is closed before the appended component closers, so they
 * are not read as code.
 */
export const autoCloseMarkdownOutsideCode = (markdown: string): string => {
  if (!markdown) return markdown
  const placeholder = absentPrivateUseCharacter(markdown)
  const lines = maskEscapedBraces(markdown, placeholder).split('\n')
  const { literal, open } = scanLiteralLines(lines)
  const masked = lines.map((line, index) => literal.has(index) ? '' : line)
  const completed = autoCloseMarkdown(masked.join('\n'), { syntax: true }).split('\n')
  for (const index of literal) completed[index] = lines[index]!
  if (open && completed.length > lines.length) {
    completed.splice(lines.length, 0, `${open.prefix}${open.marker.repeat(open.length)}`)
  }
  return completed.join('\n').split(placeholder).join('{')
}
