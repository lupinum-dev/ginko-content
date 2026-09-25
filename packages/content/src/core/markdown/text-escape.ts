/**
 * MDC-aware text escaping for the editing serializer.
 *
 * Comark escapes CommonMark syntax in text nodes, but not the MDC syntax that
 * Ginko's parser also reads: `:name` components, `::name` blocks and closers,
 * `{attrs}`, `#slot` lines, angle component tags, and scheme URLs that the
 * parser links. It also copies table-cell text without any escaping. This
 * module marks each character that needs a backslash with a placeholder
 * character before rendering. The caller replaces the placeholder with `\`
 * after rendering, so Comark's own escaping never sees, doubles, or removes
 * these escapes.
 *
 * `<` and `&` are replaced by placeholders as well. This module decides their
 * escapes, and Comark never scans the rest of the text after them.
 *
 * Every check is local or runs once per line, so escaping is linear in the
 * text length.
 */

/** Placeholder characters that the caller replaces after rendering. */
export interface MdcEscapeMarkers {
  /** Becomes `\`. */
  escape: string
  /** Becomes `<`. */
  lt: string
  /** Becomes `&`. */
  amp: string
}

// Characters that may precede an inline `:name` component (Comark's
// `ALLOWED_PREV_CHARS`). The start of a text node counts as unknown.
const COMPONENT_PREFIX = new Set([' ', '\t', '\n', '*', '_', '['])
const COMPONENT_NAME_START = /[A-Z$]/i
const TAG_START = /[A-Z!?/]/i
const ENTITY = /&#?[A-Z0-9]+;/iy
// Schemes that the parser links in plain text. Bare domains are not linked.
// `ftp:` is linked by the site parser only; the escape keeps both readings text.
const LINKED_SCHEME = /(?:^|[^A-Z0-9])(?:https?|mailto|ftp)$/i
// Top-level domains that site link recognition (linkify-it) accepts in a bare
// domain or email address: its default names, IDN names, and country codes.
// Copied from linkify-it 5 (`tlds_default` and `tlds_2ch_src_re`) to match
// its source exactly.
const LINKIFY_TLD_NAMES = 'biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|рф'
const LINKIFY_COUNTRY_CODES = 'a[cdefgilmnoqrstuwxz]|b[abdefghijmnorstvwyz]|c[acdfghiklmnoruvwxyz]|d[ejkmoz]|e[cegrstu]|f[ijkmor]|g[abdefghilmnpqrstuwy]|h[kmnrtu]|i[delmnoqrst]|j[emop]|k[eghimnprwyz]|l[abcikrstuvy]|m[acdeghklmnopqrstuvwxyz]|n[acefgilopruz]|om|p[aefghklmnrstwy]|qa|r[eosuw]|s[abcdeghijklmnortuvxyz]|t[cdfghjklmnortvwz]|u[agksyz]|v[aceginu]|w[fs]|y[et]|z[amw]'
// eslint-disable-next-line regexp/prefer-range -- keep the linkify-it source text comparable
const LINKIFY_TLD = new RegExp(`(?:${LINKIFY_TLD_NAMES}|xn--[a-z0-9-]{1,59}|${LINKIFY_COUNTRY_CODES})(?![\\p{L}\\p{N}-])`, 'iuy')
const HOST_CHARACTER = /[\p{L}\p{N}-]/u

/**
 * Offsets to escape in text that site content would link, such as the dot of
 * `a.com`, `README.md`, and `a@b.com`, and the second slash of `//host`. The
 * portable parser keeps such text as text; one escape keeps both readings
 * text. A run with an escaped scheme, such as `https\://a.com`, is text
 * already.
 */
const bareLinkDots = (text: string): number[] => {
  const dots: number[] = []
  let runStart = 0
  let schemeRun = false
  for (let offset = 0; offset < text.length; offset++) {
    const char = text[offset]!
    if (/\s/.test(char)) {
      runStart = offset + 1
      schemeRun = false
      continue
    }
    if (char === ':' && LINKED_SCHEME.test(text.slice(Math.max(runStart, offset - 7), offset))) schemeRun = true
    if (schemeRun) continue
    // A protocol-relative `//host` needs no top-level domain. Link recognition
    // accepts it after a boundary that is not a word, `.`, `:`, `/`, `-`,
    // `_`, `@`, or `\` character.
    if (
      char === '/' && text[offset - 1] === '/' && HOST_CHARACTER.test(text[offset + 1] ?? '') &&
      !/[\p{L}\p{N}.:/\\_@-]/u.test(text[offset - 2] ?? ' ')
    ) {
      dots.push(offset)
      schemeRun = true
      continue
    }
    if (char !== '.' || !HOST_CHARACTER.test(text[offset - 1] ?? '')) continue
    LINKIFY_TLD.lastIndex = offset + 1
    if (LINKIFY_TLD.test(text)) dots.push(offset)
  }
  return dots
}

/** A line that could complete a GFM table under the previous text line. */
const isTableDelimiterRow = (line: string) => /^[|:-][|:\- \t]*$/.test(line) && line.includes('-')

const isAlphaNumeric = (char: string | undefined) => char !== undefined && /[A-Z0-9]/i.test(char)

/** Characters that Comark escapes itself outside table cells. */
const comarkEscapesInline = (text: string, offset: number): boolean => {
  switch (text[offset]) {
    case '\\': case '`': case '*': case '~': case '[': case ']':
      return true
    case '_':
      return !(isAlphaNumeric(text[offset - 1]) && isAlphaNumeric(text[offset + 1]))
    default:
      return false
  }
}

/**
 * Whether a CommonMark block marker or MDC line syntax starts `line`, the
 * rest of a line from its first non-blank character. Comark escapes block
 * markers only at the first column of a line it knows starts one; component
 * children and indented lines are not covered.
 */
const startsLineSyntax = (line: string): boolean => {
  if (isTableDelimiterRow(line)) return true
  const next = line[1]
  switch (line[0]) {
    // `#name` opens a named slot inside a block component.
    case '#': return /^#{1,6}(?:[ \t]|$)/.test(line) || (next !== ' ' && next !== '\t' && next !== '#')
    case '>': return true
    case '-': return /^-(?:[ \t-]|$)/.test(line)
    case '+': return /^\+(?:[ \t]|$)/.test(line)
    case '=': return /^=+[ \t]*$/.test(line)
    // `::name` opens a block component and a bare `::` closes one.
    case ':': return next === ':' || next === undefined
    default: return false
  }
}

/**
 * Whether the parser could read syntax that starts at `offset`, apart from
 * line-start syntax. `<` and `&` are decided here for both contexts.
 */
const startsInlineSyntax = (text: string, offset: number): boolean => {
  const previous = text[offset - 1]
  const next = text[offset + 1]
  switch (text[offset]) {
    case ':':
      if (next !== undefined && COMPONENT_NAME_START.test(next) && (offset === 0 || COMPONENT_PREFIX.has(previous!))) return true
      // `https:` and `mailto:` would become links.
      return LINKED_SCHEME.test(text.slice(Math.max(0, offset - 7), offset))
    case '{':
      // `{{ value }}` and `${value}` are never attribute lists.
      return next !== '{' && previous !== '{' && previous !== '$'
    case '<':
      // Angle tags, autolinks, and HTML comments need no closing `>` to start.
      return next !== undefined && TAG_START.test(next)
    case '&':
      ENTITY.lastIndex = offset
      return ENTITY.test(text)
    default:
      return false
  }
}

/**
 * Insert `markers.escape` before every character that needs a backslash and
 * replace `<` and `&` with their placeholders. With `rawContext`, Comark
 * writes the text without its own escaping (table cells), so CommonMark inline
 * syntax is marked as well and line-start syntax does not apply. `forced`
 * offsets are marked unconditionally.
 */
export function markMdcTextEscapes(
  text: string,
  markers: MdcEscapeMarkers,
  rawContext = false,
  forced?: ReadonlySet<number>,
): string {
  let result = ''
  // Offset of the first non-blank character of the current line, and the
  // length of the digit run that starts there.
  let contentStart = -1
  let digits = 0
  let lineStart = true
  for (let offset = 0; offset < text.length; offset++) {
    const char = text[offset]!
    if (lineStart && char !== ' ' && char !== '\t') {
      contentStart = offset
      digits = 0
      lineStart = false
    }
    if (offset === contentStart + digits && char >= '0' && char <= '9') digits++

    let escape = forced?.has(offset) || startsInlineSyntax(text, offset)
    if (rawContext) {
      escape ||= comarkEscapesInline(text, offset)
    } else {
      if (!escape && offset === contentStart) {
        const end = text.indexOf('\n', offset)
        escape = startsLineSyntax(text.slice(offset, end === -1 ? undefined : end))
      }
      // `1.` or `1)` followed by a blank starts an ordered list.
      if (!escape && (char === '.' || char === ')') && digits > 0 && digits <= 9 && offset === contentStart + digits) {
        const next = text[offset + 1]
        escape = next === undefined || next === ' ' || next === '\t' || next === '\n'
      }
      // Comark escapes these itself; a second marker would double the backslash.
      if (comarkEscapesInline(text, offset)) escape = false
    }

    if (escape) result += markers.escape
    result += char === '<' ? markers.lt : char === '&' ? markers.amp : char
    if (char === '\n') lineStart = true
  }
  return result
}

/** The closing `#` run of an ATX heading line, which the parser removes. */
const closingHeadingSequence = (text: string): ReadonlySet<number> | undefined => {
  let end = text.length
  while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--
  let start = end
  while (start > 0 && text[start - 1] === '#') start--
  if (start === end || start === 0) return undefined
  const before = text[start - 1]
  return before === ' ' || before === '\t' ? new Set([start]) : undefined
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
export function markMdcTreeEscapes(nodes: unknown[], markers: MdcEscapeMarkers): void {
  const visit = (node: unknown[], inHeading: boolean, inLink = false) => {
    const tag = node[0]
    const link = inLink || tag === 'a'
    if (tag === null || (typeof tag === 'string' && LITERAL_TAGS.has(tag))) return
    const verbatimText = isRawHtmlBlock(node[1])
    const rawContext = tag === 'th' || tag === 'td'
    const heading = inHeading || (typeof tag === 'string' && /^h[1-6]$/.test(tag))
    const textBlock = isTextBlock(node)
    // Adjacent text nodes render as one run; escape them as one.
    for (let index = node.length - 1; index > 2; index--) {
      if (typeof node[index] === 'string' && typeof node[index - 1] === 'string') {
        node.splice(index - 1, 2, `${node[index - 1] as string}${node[index] as string}`)
      }
    }
    for (let index = 2; index < node.length; index++) {
      const child = node[index]
      if (typeof child === 'string') {
        if (verbatimText) continue
        // Whitespace at the edges of a text block has no Markdown form, and
        // leading indentation could continue a preceding list.
        let text = child
        if (textBlock && index === 2) text = text.trimStart()
        if (textBlock && index === node.length - 1) text = text.trimEnd()
        // `!` before a link would turn the link into an image.
        const next = node[index + 1]
        const beforeLink = Array.isArray(next) && (next[0] === 'a' || next[0] === 'span') && text.endsWith('!')
        node[index] = markTextNode(text, markers, { rawContext, heading, last: heading && !inHeading && index === node.length - 1, beforeLink, inLink: link })
      } else if (Array.isArray(child)) {
        visit(child, heading, link)
      }
    }
  }
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (typeof node === 'string') nodes[index] = markTextNode(node, markers, {})
    else if (Array.isArray(node)) visit(node, false)
  }
}

const isBlank = (char: string | undefined) => char === ' ' || char === '\t'

/**
 * Remove spaces and tabs around each line break and join the lines with
 * `separator`. A regular expression such as `/[ \t]*\n/` would retry every
 * blank of a long run, which is quadratic.
 */
const joinLines = (text: string, separator: string): string => {
  // Markdown reads `\r\n` and a lone `\r` as line breaks too.
  const lines = text.split(/\r\n?|\n/)
  if (lines.length === 1) return text
  return lines.map((line, index) => {
    let start = 0
    let end = line.length
    if (index > 0) while (start < end && isBlank(line[start])) start++
    if (index < lines.length - 1) while (end > start && isBlank(line[end - 1])) end--
    return line.slice(start, end)
  }).join(separator)
}

const markTextNode = (
  value: string,
  markers: MdcEscapeMarkers,
  context: { rawContext?: boolean, heading?: boolean, last?: boolean, beforeLink?: boolean, inLink?: boolean },
): string => {
  // Trailing spaces before a line break would form a hard break. An ATX
  // heading and a table cell are one line. These whitespace changes do not
  // alter rendered text.
  // Spaces at the start of a continuation line do not render either.
  const text = joinLines(value, context.heading || context.rawContext ? ' ' : '\n')
  const forced = new Set(context.last ? closingHeadingSequence(text) : undefined)
  if (context.beforeLink && text.endsWith('!')) forced.add(text.length - 1)
  // Link recognition does not run inside link text.
  if (!context.inLink) for (const dot of bareLinkDots(text)) forced.add(dot)
  return markMdcTextEscapes(text, markers, context.rawContext, forced)
}

/** Private-use characters absent from `source`, used as reversible markers. */
export function absentPrivateUseCharacters(source: string, count: number): string[] {
  const characters: string[] = []
  for (let codePoint = 0xE000; codePoint <= 0xF8FF && characters.length < count; codePoint++) {
    const candidate = String.fromCharCode(codePoint)
    if (!source.includes(candidate)) characters.push(candidate)
  }
  if (characters.length < count) throw new Error('Markdown source exhausts the private-use placeholder range.')
  return characters
}

/** A private-use character absent from `source`, used as a reversible marker. */
export function absentPrivateUseCharacter(source: string): string {
  return absentPrivateUseCharacters(source, 1)[0]!
}
