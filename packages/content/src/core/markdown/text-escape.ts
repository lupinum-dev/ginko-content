/**
 * MDC-aware text escaping for the editing serializer.
 *
 * Comark escapes CommonMark syntax in text nodes, but not the MDC syntax that
 * Ginko's parser also reads: `:name` components, `::name` blocks and closers,
 * `{attrs}`, `#slot` lines, and angle component tags. It also copies table-cell
 * text without any escaping. This module marks each character that needs a
 * backslash with a placeholder character before rendering. The caller
 * replaces the placeholder with `\` after rendering, so Comark's own escaping
 * never sees, doubles, or removes these escapes.
 */

// Characters that may precede an inline `:name` component (Comark's
// `ALLOWED_PREV_CHARS`). The start of a text node counts as unknown.
const COMPONENT_PREFIX = new Set([' ', '\t', '\n', '*', '_', '['])
const COMPONENT_NAME_START = /[A-Za-z$]/
const TAG_START = /[A-Za-z!?/]/

/** A line that could complete a GFM table under the previous text line. */
const isTableDelimiterRow = (line: string) => /^[|:-][|:\- \t]*$/.test(line) && line.includes('-')

const isAlphaNumeric = (char: string | undefined) => char !== undefined && /[A-Za-z0-9]/.test(char)

/** Comark escapes these characters itself outside table cells. */
const comarkEscapesInline = (text: string, offset: number): boolean => {
  const char = text[offset]
  switch (char) {
    case '\\': case '`': case '*': case '~': case '[': case ']':
      return true
    case '_':
      return !(isAlphaNumeric(text[offset - 1]) && isAlphaNumeric(text[offset + 1]))
    case '<':
      return /^<[a-zA-Z!?/][^>]*>/.test(text.slice(offset))
    case '&':
      return /^&#?[a-zA-Z0-9]+;/.test(text.slice(offset))
    default:
      return false
  }
}

/**
 * True when only spaces or tabs separate `offset` from the start of its line.
 * The start of a text node counts as a line start, because the text before it
 * belongs to another node.
 */
const atLineStart = (text: string, offset: number): boolean => {
  for (let index = offset - 1; index >= 0; index--) {
    const char = text[index]
    if (char === '\n') return true
    if (char !== ' ' && char !== '\t') return false
  }
  return true
}

const lineAt = (text: string, offset: number): string => {
  const end = text.indexOf('\n', offset)
  return text.slice(offset, end === -1 ? undefined : end)
}

/** Offset of the first character after the indentation of the line at `offset`. */
const contentStart = (text: string, offset: number): number => {
  let start = text.lastIndexOf('\n', offset - 1) + 1
  while (text[start] === ' ' || text[start] === '\t') start++
  return start
}

/**
 * Whether a CommonMark block marker starts at `offset`. Comark escapes these
 * only at the first column of a line it knows starts one; component children
 * and indented lines are not covered.
 */
const startsBlockMarker = (text: string, offset: number): boolean => {
  const rest = lineAt(text, offset)
  switch (text[offset]) {
    case '#': return /^#{1,6}([ \t]|$)/.test(rest)
    case '>': return true
    case '-': return /^-([ \t-]|$)/.test(rest)
    case '+': return /^\+([ \t]|$)/.test(rest)
    case '=': return /^=+[ \t]*$/.test(rest)
    default: return false
  }
}

/** Whether `offset` is the `.` or `)` of an ordered-list marker such as `1.`. */
const isOrderedListDelimiter = (text: string, offset: number): boolean => {
  const char = text[offset]
  if (char !== '.' && char !== ')') return false
  const next = text[offset + 1]
  if (next !== undefined && next !== ' ' && next !== '\t' && next !== '\n') return false
  return /^\d{1,9}$/.test(text.slice(contentStart(text, offset), offset))
}

/** Whether the parser could read MDC syntax that starts at `offset`. */
const startsMdcSyntax = (text: string, offset: number): boolean => {
  const char = text[offset]
  const previous = text[offset - 1]
  const next = text[offset + 1]
  const lineStart = atLineStart(text, offset) && char !== ' ' && char !== '\t'
  if (lineStart && (isTableDelimiterRow(lineAt(text, offset)) || startsBlockMarker(text, offset))) return true
  if (isOrderedListDelimiter(text, offset)) return true
  switch (char) {
    case ':':
      if (next !== undefined && COMPONENT_NAME_START.test(next) && (offset === 0 || COMPONENT_PREFIX.has(previous!))) return true
      // `::name` opens a block component and a bare `::` closes one.
      return lineStart && (next === ':' || next === undefined)
    case '{':
      // `{{ value }}` and `${value}` are never attribute lists.
      return next !== '{' && previous !== '{' && previous !== '$'
    case '#':
      // `#name` opens a named slot inside a block component.
      return lineStart && next !== ' ' && next !== '\t' && next !== '#'
    case '<':
      // Angle component tags and HTML comments need no closing `>` to start.
      return next !== undefined && TAG_START.test(next)
    default:
      return false
  }
}

/**
 * Insert `marker` before every character that needs a backslash. With
 * `rawContext`, Comark writes the text without its own escaping (table cells),
 * so CommonMark inline syntax is marked as well. `forced` offsets are marked
 * unconditionally.
 */
export function markMdcTextEscapes(text: string, marker: string, rawContext = false, forced?: ReadonlySet<number>): string {
  let result = ''
  for (let offset = 0; offset < text.length; offset++) {
    const needsEscape = forced?.has(offset) || (rawContext
      ? comarkEscapesInline(text, offset) || startsMdcSyntax(text, offset)
      : !comarkEscapesInline(text, offset) && startsMdcSyntax(text, offset))
    if (needsEscape) result += marker
    result += text[offset]
  }
  return result
}

/** The closing `#` run of an ATX heading line, which the parser removes. */
const closingHeadingSequence = (text: string): ReadonlySet<number> | undefined => {
  const match = /[ \t](#+)[ \t]*$/.exec(text)
  return match ? new Set([match.index + 1]) : undefined
}

const LITERAL_TAGS = new Set(['code', 'pre', 'math', 'mermaid'])
const TEXT_BLOCK_TAGS = new Set(['p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'blockquote', 'template'])

const isTextBlock = (node: unknown[]): boolean => {
  if (typeof node[0] === 'string' && TEXT_BLOCK_TAGS.has(node[0])) return true
  const props = node[1]
  return isRecord(props) && isRecord(props.$) && props.$.block === 1 && props.$.html !== 1
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isRawHtmlBlock = (props: unknown): boolean => {
  if (!isRecord(props) || !isRecord(props.$)) return false
  return props.$.html === 1 && props.$.block === 1
}

/**
 * Mark escapes in every text node of a Comark tuple tree, in place. Code, math,
 * Mermaid, comments, and raw HTML block text stay verbatim.
 */
export function markMdcTreeEscapes(nodes: unknown[], marker: string): void {
  const visit = (node: unknown[], inHeading: boolean) => {
    const tag = node[0]
    if (tag === null || (typeof tag === 'string' && LITERAL_TAGS.has(tag))) return
    const verbatimText = isRawHtmlBlock(node[1])
    const rawContext = tag === 'th' || tag === 'td'
    const heading = inHeading || (typeof tag === 'string' && /^h[1-6]$/.test(tag))
    const textBlock = isTextBlock(node)
    for (let index = 2; index < node.length; index++) {
      const child = node[index]
      if (typeof child === 'string') {
        if (verbatimText) continue
        // Whitespace at the edges of a text block has no Markdown form, and
        // leading indentation could continue a preceding list.
        let text = child
        if (textBlock && index === 2) text = text.replace(/^\s+/, '')
        if (textBlock && index === node.length - 1) text = text.replace(/\s+$/, '')
        node[index] = markTextNode(text, marker, { rawContext, heading, last: heading && !inHeading && index === node.length - 1 })
      } else if (Array.isArray(child)) {
        visit(child, heading)
      }
    }
  }
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (typeof node === 'string') nodes[index] = markTextNode(node, marker, {})
    else if (Array.isArray(node)) visit(node, false)
  }
}

const markTextNode = (
  value: string,
  marker: string,
  context: { rawContext?: boolean, heading?: boolean, last?: boolean },
): string => {
  // Trailing spaces before a line break would form a hard break, and an ATX
  // heading is one line. Neither whitespace change alters rendered text.
  let text = value.replace(/[ \t]+(?=\n)/g, '')
  if (context.heading) text = text.replace(/[ \t]*\n[ \t]*/g, ' ')
  const forced = context.last ? closingHeadingSequence(text) : undefined
  return markMdcTextEscapes(text, marker, context.rawContext, forced)
}

/** A private-use character absent from `source`, used as a reversible marker. */
export function absentPrivateUseCharacter(source: string): string {
  for (let codePoint = 0xE000; codePoint <= 0xF8FF; codePoint++) {
    const candidate = String.fromCharCode(codePoint)
    if (!source.includes(candidate)) return candidate
  }
  throw new Error('Markdown source exhausts the private-use placeholder range.')
}
