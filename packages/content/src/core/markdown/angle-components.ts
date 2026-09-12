import { decodeHTML, escapeAttribute } from 'entities'
import { defineComarkPlugin } from 'comark'
import type { ConditionalNodeHandler, ElementNode, Node } from 'comark'
import { canonicalizePortableComponentName } from './component-name.js'
import { HTML_TAGS } from './html-tags.js'

// NUL cannot occur in an authored HTML attribute name. It keeps the token-only
// handoff distinct from document props until the post hook replaces it.
const TOKEN_MARKER = '\0ginko-angle-component'

export type AngleComponentSyntaxIssueCode =
  | 'duplicate_prop'
  | 'duplicate_slot'
  | 'invalid_binding'
  | 'invalid_prop'
  | 'mismatched_tag'
  | 'misplaced_slot'
  | 'mixed_default_slot'
  | 'orphan_close'
  | 'unclosed_tag'

export class AngleComponentSyntaxError extends Error {
  readonly code: AngleComponentSyntaxIssueCode
  readonly line: number
  readonly column: number
  readonly openingTag: string

  constructor(
    code: AngleComponentSyntaxIssueCode,
    message: string,
    location: { line: number; column: number; openingTag: string },
  ) {
    super(message)
    this.name = 'AngleComponentSyntaxError'
    this.code = code
    this.line = location.line
    this.column = location.column
    this.openingTag = location.openingTag
  }
}

interface ParsedTag {
  name: string
  canonicalName: string
  props: Array<[string, unknown]>
  closing: boolean
  selfClosing: boolean
  end: number
  slotName?: string
}

interface ParseLocation {
  line: number
  column: number
  openingTag: string
}

interface ParsedTagHead {
  name: string
  closing: boolean
}

interface TokenMarker extends ParseLocation {
  block: 0 | 1
  sourceName: string
}

const NAME = /^[A-Z][A-Z0-9_.-]*/i
const PROP_NAME = /^:?[A-Z_][A-Z0-9_.-]*/i

const isExplicitComponentName = (name: string) =>
  /^[A-Z]/.test(name) || (!HTML_TAGS.has(name) && name !== 'template')

const parseTagHead = (source: string, offset: number): ParsedTagHead | undefined => {
  if (source[offset] !== '<') return undefined
  let cursor = offset + 1
  const closing = source[cursor] === '/'
  if (closing) cursor += 1
  const nameMatch = NAME.exec(source.slice(cursor))
  if (!nameMatch) return undefined
  return { name: nameMatch[0], closing }
}

const isMarkdownAutolink = (source: string, offset: number): boolean => {
  const end = source.indexOf('>', offset + 1)
  if (end < 0) return false
  const body = source.slice(offset + 1, end)
  return /^[a-z][a-z0-9+.-]{1,31}:[^\s<>]*$/i.test(body) ||
    /^[^\s<>@]+@[^\s<>@]+$/.test(body)
}

const isAngleCandidate = (source: string, offset: number, includeTemplate = false) => {
  const head = parseTagHead(source, offset)
  if (!head || isMarkdownAutolink(source, offset)) return undefined
  if (head.name === 'template') return includeTemplate ? head : undefined
  return isExplicitComponentName(head.name) ? head : undefined
}

const syntaxError = (
  code: AngleComponentSyntaxIssueCode,
  message: string,
  location: ParseLocation,
): never => {
  throw new AngleComponentSyntaxError(code, message, location)
}

function parseAngleTag(source: string, offset: number, location: ParseLocation): ParsedTag | undefined {
  if (source[offset] !== '<') return undefined
  let cursor = offset + 1
  const closing = source[cursor] === '/'
  if (closing) cursor += 1
  const nameMatch = NAME.exec(source.slice(cursor))
  if (!nameMatch) return undefined
  const name = nameMatch[0]
  cursor += name.length
  const props: Array<[string, unknown]> = []
  const seen = new Set<string>()
  let slotName: string | undefined

  const skipWhitespace = () => {
    while (/\s/.test(source[cursor] ?? '')) cursor += 1
  }

  skipWhitespace()
  if (closing) {
    if (source[cursor] !== '>') return undefined
    return { name, canonicalName: canonicalizePortableComponentName(name), props, closing, selfClosing: false, end: cursor + 1 }
  }

  while (cursor < source.length && source[cursor] !== '>') {
    if (source.startsWith('/>', cursor)) {
      return {
        name,
        canonicalName: canonicalizePortableComponentName(name),
        props,
        closing: false,
        selfClosing: true,
        end: cursor + 2,
        slotName,
      }
    }

    if (name === 'template' && source[cursor] === '#') {
      cursor += 1
      const slotMatch = /^[A-Z][A-Z0-9_-]*/i.exec(source.slice(cursor))
      if (!slotMatch || slotName) syntaxError('invalid_prop', 'Named slot syntax is malformed.', location)
      slotName = slotMatch![0]
      cursor += slotName.length
      skipWhitespace()
      continue
    }

    const propMatch = PROP_NAME.exec(source.slice(cursor))
    if (!propMatch) syntaxError('invalid_prop', `Invalid property syntax on <${name}>.`, location)
    const authoredName = propMatch![0]
    const binding = authoredName.startsWith(':')
    const propName = binding ? authoredName.slice(1) : authoredName
    const identity = propName.toLowerCase()
    if (
      seen.has(identity) || propName === '$' || /^on/i.test(propName) ||
      /^v-|^@|^#/.test(authoredName) || ['__proto__', 'prototype', 'constructor'].includes(identity)
    ) {
      syntaxError(
        seen.has(identity) ? 'duplicate_prop' : 'invalid_prop',
        seen.has(identity) ? `Property "${propName}" is duplicated.` : `Property "${authoredName}" is not allowed.`,
        location,
      )
    }
    seen.add(identity)
    cursor += authoredName.length
    skipWhitespace()

    if (source[cursor] !== '=') {
      if (binding) syntaxError('invalid_binding', `Binding ":${propName}" requires a JSON value.`, location)
      props.push([propName, true])
      continue
    }
    cursor += 1
    skipWhitespace()
    const quote = source[cursor]
    if (quote !== '"' && quote !== "'") {
      syntaxError(binding ? 'invalid_binding' : 'invalid_prop', `Property "${authoredName}" must use a quoted value.`, location)
    }
    cursor += 1
    const valueStart = cursor
    while (cursor < source.length && source[cursor] !== quote) cursor += 1
    if (cursor >= source.length) syntaxError('invalid_prop', `Property "${authoredName}" has no closing quote.`, location)
    const encodedValue = source.slice(valueStart, cursor)
    cursor += 1
    skipWhitespace()

    if (!binding) {
      props.push([propName, decodeHTML(encodedValue)])
      continue
    }
    try {
      const value: unknown = JSON.parse(decodeHTML(encodedValue))
      if (!isFiniteJson(value)) throw new TypeError('Non-finite number')
      props.push([propName, value])
    } catch {
      syntaxError('invalid_binding', `Binding ":${propName}" must contain finite JSON.`, location)
    }
  }

  if (source[cursor] !== '>') return undefined
  return {
    name,
    canonicalName: canonicalizePortableComponentName(name),
    props,
    closing: false,
    selfClosing: false,
    end: cursor + 1,
    slotName,
  }
}

const isFiniteJson = (value: unknown): boolean => {
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isFiniteJson)
  if (value && typeof value === 'object') return Object.values(value).every(isFiniteJson)
  return value === null || ['string', 'boolean'].includes(typeof value)
}

interface BlockToken {
  type: string
  content: string
  map?: [number, number] | null
}

type BlockState = {
  src: string
  env: Record<PropertyKey, unknown>
  bMarks: number[]
  eMarks: number[]
  tShift: number[]
  sCount: number[]
  blkIndent: number
  line: number
  lineMax: number
  parentType: string
  tokens: BlockToken[]
  md: {
    block: {
      State: new (source: string, markdown: BlockState['md'], env: Record<PropertyKey, unknown>, tokens: BlockToken[]) => BlockState
      tokenize: (state: BlockState, start: number, end: number) => void
    }
  }
  push: (type: string, tag: string, nesting: number) => AngleToken
}

interface AngleToken {
  block: boolean
  map: [number, number] | null
  attrSet: (name: string, value: unknown) => void
}

interface InlineState {
  src: string
  pos: number
  posMax: number
  env: Record<PropertyKey, unknown>
  md: { inline: { tokenize: (state: InlineState) => void } }
  push: (type: string, tag: string, nesting: number) => AngleToken
}

interface CoreState {
  src: string
  env: Record<PropertyKey, unknown>
  tokens: Array<{ type: string; content: string; map?: [number, number] | null }>
}

const INLINE_LOCATIONS = Symbol('ginko-angle-inline-locations')
const ANALYZE_BLOCKS = Symbol('ginko-angle-analyze-blocks')
const protectedCodeLineCache = new WeakMap<object, Map<string, Set<number>>>()
interface InlineLocationBase {
  line: number
  columns: number[]
}
const inlineStateLocations = new WeakMap<object, InlineLocationBase>()

const lineText = (state: BlockState, line: number) =>
  state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])

const parseWholeLineTag = (
  state: BlockState,
  line: number,
  strict: boolean,
): ParsedTag | undefined => {
  if ((state.sCount[line] ?? 0) - state.blkIndent >= 4) return undefined
  const source = lineText(state, line)
  const location = { line: line + 1, column: (state.tShift[line] ?? 0) + 1, openingTag: source.trim() }
  const start = source.search(/\S/)
  if (start < 0) return undefined
  if (!isAngleCandidate(source, start, true)) return undefined
  const parsed = parseAngleTag(source, start, location)
  if (!parsed) {
    if (strict) syntaxError('invalid_prop', 'Component tag is incomplete.', location)
    return undefined
  }
  if (source.slice(parsed.end).trim()) return undefined
  return parsed
}

interface Fence {
  marker: '`' | '~'
  length: number
}

const openFence = (line: string): Fence | undefined => {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
  if (!match || (match[1]![0] === '`' && match[2]!.includes('`'))) return undefined
  return { marker: match[1]![0] as Fence['marker'], length: match[1]!.length }
}

const closesFence = (line: string, fence: Fence): boolean => {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)
  return Boolean(match && match[1]![0] === fence.marker && match[1]!.length >= fence.length)
}

function findBlockClose(
  state: BlockState,
  opening: ParsedTag,
  startLine: number,
  endLine: number,
  autoClose: boolean,
): number {
  const stack = [opening.name]
  const protectedCodeLines = collectProtectedCodeLines(state, startLine + 1, endLine)
  let fence: Fence | undefined
  let inComment = false
  for (let line = startLine + 1; line < endLine; line += 1) {
    const text = lineText(state, line)
    const trimmed = text.trim()
    const indentation = (state.sCount[line] ?? 0) - state.blkIndent
    if (fence) {
      if (indentation <= 3 && closesFence(text, fence)) fence = undefined
      continue
    }
    if (inComment) {
      if (trimmed.includes('-->')) inComment = false
      continue
    }
    if (indentation <= 3 && trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inComment = true
      continue
    }
    fence = indentation <= 3 ? openFence(text) : undefined
    if (fence) continue
    if (protectedCodeLines.has(line)) continue
    const tag = parseWholeLineTag(state, line, !autoClose)
    if (!tag) continue
    const eligible = isExplicitComponentName(tag.name) || tag.name === 'template'
    if (!eligible) continue
    if (!tag.closing && !tag.selfClosing) stack.push(tag.name)
    if (!tag.closing) continue
    const expected = stack[stack.length - 1]
    if (expected !== tag.name) {
      syntaxError('mismatched_tag', `Expected </${expected}> but found </${tag.name}>.`, {
        line: line + 1,
        column: (state.tShift[line] ?? 0) + 1,
        openingTag: `<${opening.name}>`,
      })
    }
    stack.pop()
    if (stack.length === 0) return line
  }
  if (autoClose) return endLine
  return syntaxError('unclosed_tag', `Component <${opening.name}> is not closed.`, {
    line: startLine + 1,
    column: (state.tShift[startLine] ?? 0) + 1,
    openingTag: `<${opening.name}>`,
  })
}

function pushProps(token: AngleToken, parsed: ParsedTag, marker: TokenMarker) {
  for (const [name, value] of parsed.props) token.attrSet(name, value)
  if (parsed.slotName) token.attrSet('name', parsed.slotName)
  token.attrSet(TOKEN_MARKER, JSON.stringify(marker))
}

const inlineLocation = (state: InlineState, offset = state.pos): ParseLocation => {
  let base = inlineStateLocations.get(state)
  if (!base) {
    const locations = state.env[INLINE_LOCATIONS] as Array<InlineLocationBase & { content: string }> | undefined
    const index = locations?.findIndex(candidate => candidate.content === state.src) ?? -1
    const match = index >= 0 ? locations!.splice(index, 1)[0] : undefined
    base = { line: match?.line ?? 1, columns: match?.columns ?? [1] }
    inlineStateLocations.set(state, base)
  }
  const before = state.src.slice(0, offset)
  const newline = before.lastIndexOf('\n')
  const relativeLine = before.match(/\n/g)?.length ?? 0
  return {
    line: base.line + relativeLine,
    column: (base.columns[relativeLine] ?? 1) + (newline < 0 ? before.length : before.length - newline - 1),
    openingTag: state.src.slice(offset, offset + 80),
  }
}

const skipCodeSpan = (source: string, offset: number, end: number): number | undefined => {
  let runEnd = offset
  while (source[runEnd] === '`') runEnd += 1
  const marker = source.slice(offset, runEnd)
  let cursor = runEnd
  while (cursor < end) {
    const next = source.indexOf('`', cursor)
    if (next < 0) return undefined
    let nextEnd = next
    while (source[nextEnd] === '`') nextEnd += 1
    if (nextEnd - next === marker.length) return nextEnd
    cursor = nextEnd
  }
  return undefined
}

// Reuse this MarkdownIt instance's block rules to identify the inline-token ranges
// where multiline code spans can exist. The WeakMap lasts only as long as the
// current block state and avoids repeating the analysis for every paragraph line.
const collectProtectedCodeLines = (state: BlockState, startLine: number, endLine: number): Set<number> => {
  let cache = protectedCodeLineCache.get(state)
  if (!cache) {
    cache = new Map()
    protectedCodeLineCache.set(state, cache)
  }
  const cacheKey = `${startLine}:${endLine}:${state.blkIndent}:${state.bMarks[startLine]}:${state.tShift[startLine]}`
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const tokens: BlockToken[] = []
  const analysis = new state.md.block.State(
    state.src,
    state.md,
    { ...state.env, [ANALYZE_BLOCKS]: true },
    tokens,
  )
  analysis.bMarks = state.bMarks.slice()
  analysis.eMarks = state.eMarks.slice()
  analysis.tShift = state.tShift.slice()
  analysis.sCount = state.sCount.slice()
  analysis.blkIndent = state.blkIndent
  analysis.lineMax = state.lineMax
  state.md.block.tokenize(analysis, startLine, endLine)

  const protectedLines = new Set<number>()
  for (const token of tokens) {
    if (token.type !== 'inline' || !token.map || !token.content.includes('`')) continue
    let cursor = 0
    while (cursor < token.content.length) {
      const opening = token.content.indexOf('`', cursor)
      if (opening < 0) break
      let escapes = 0
      while (token.content[opening - escapes - 1] === '\\') escapes += 1
      if (escapes % 2 === 1) {
        cursor = opening + 1
        continue
      }
      const closing = skipCodeSpan(token.content, opening, token.content.length)
      if (!closing) {
        cursor = opening + 1
        continue
      }
      const openingLine = token.content.slice(0, opening).match(/\n/g)?.length ?? 0
      const closingLine = token.content.slice(0, closing).match(/\n/g)?.length ?? 0
      for (let line = openingLine + 1; line <= closingLine; line += 1) {
        protectedLines.add(token.map[0] + line)
      }
      cursor = closing
    }
  }
  cache.set(cacheKey, protectedLines)
  return protectedLines
}

const skipTagLikeConstruct = (source: string, offset: number, end: number): number | undefined => {
  if (!parseTagHead(source, offset) && !source.startsWith('<!', offset) && !source.startsWith('<?', offset)) {
    return undefined
  }
  let quote: '"' | "'" | undefined
  for (let cursor = offset + 1; cursor < end; cursor += 1) {
    const character = source[cursor]
    if (quote) {
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '>') return cursor + 1
  }
  return undefined
}

function findInlineClose(
  state: InlineState,
  opening: ParsedTag,
): { contentEnd: number; closingEnd: number } | undefined {
  const stack = [opening.name]
  let cursor = opening.end
  while (cursor < state.posMax) {
    const character = state.src[cursor]
    if (character === '\\') {
      cursor += Math.min(2, state.posMax - cursor)
      continue
    }
    if (character === '`') {
      const codeEnd = skipCodeSpan(state.src, cursor, state.posMax)
      if (codeEnd) {
        cursor = codeEnd
        continue
      }
    }
    if (state.src.startsWith('<!--', cursor)) {
      const commentEnd = state.src.indexOf('-->', cursor + 4)
      cursor = commentEnd < 0 ? state.posMax : commentEnd + 3
      continue
    }
    if (character !== '<') {
      cursor += 1
      continue
    }
    const head = isAngleCandidate(state.src, cursor)
    if (!head) {
      cursor = skipTagLikeConstruct(state.src, cursor, state.posMax) ?? cursor + 1
      continue
    }
    const location = inlineLocation(state, cursor)
    const tag = parseAngleTag(state.src, cursor, location)
    if (!tag) return syntaxError('invalid_prop', `Component <${head.name}> is incomplete.`, location)
    if (!tag.closing && !tag.selfClosing) stack.push(tag.name)
    if (tag.closing) {
      const expected = stack[stack.length - 1]
      if (expected !== tag.name) {
        syntaxError('mismatched_tag', `Expected </${expected}> but found </${tag.name}>.`, location)
      }
      stack.pop()
      if (!stack.length) return { contentEnd: cursor, closingEnd: tag.end }
    }
    cursor = tag.end
  }
  return undefined
}

export const angleComponents = (options: { autoClose: boolean }) => defineComarkPlugin(() => ({
  name: 'ginko-angle-components',
  markdownItPlugins: [
    (markdown) => {
      markdown.core.ruler.before('inline', `${TOKEN_MARKER}-locations`, (state: CoreState) => {
        const sourceLines = state.src.split('\n')
        state.env[INLINE_LOCATIONS] = state.tokens
          .filter(token => token.type === 'inline' && token.map)
          .map((token) => {
            const line = token.map![0]
            const columns = token.content.split('\n').map((contentLine, index) => {
              const sourceLine = sourceLines[line + index] ?? ''
              const offset = sourceLine.indexOf(contentLine)
              return offset < 0 ? 1 : offset + 1
            })
            return { content: token.content, line: line + 1, columns }
          })
      })
      markdown.block.ruler.before(
        'html_block',
        TOKEN_MARKER,
        (state: BlockState, startLine: number, endLine: number, silent: boolean) => {
          if (state.env[ANALYZE_BLOCKS]) return false
          if (
            state.parentType === 'paragraph' &&
            collectProtectedCodeLines(state, state.line, endLine).has(startLine)
          ) return false
          const opening = parseWholeLineTag(state, startLine, !options.autoClose)
          if (!opening) return false
          if (opening.closing) {
            if (!options.autoClose) {
              syntaxError('orphan_close', `Closing tag </${opening.name}> has no opening tag.`, {
                line: startLine + 1,
                column: (state.tShift[startLine] ?? 0) + 1,
                openingTag: `</${opening.name}>`,
              })
            }
            return false
          }
          if (opening.name === 'template' && !opening.slotName) return false
          if (silent) return true

          const location = {
            block: 1 as const,
            sourceName: opening.name,
            line: startLine + 1,
            column: (state.tShift[startLine] ?? 0) + 1,
            openingTag: `<${opening.name}>`,
          }

          if (opening.selfClosing) {
            const token = state.push('mdc_block_open', opening.canonicalName, 0)
            token.block = true
            token.map = [startLine, startLine + 1]
            pushProps(token, opening, location)
            state.line = startLine + 1
            return true
          }

          const closingLine = findBlockClose(state, opening, startLine, endLine, options.autoClose)
          const open = state.push('mdc_block_open', opening.name === 'template' ? 'template' : opening.canonicalName, 1)
          open.block = true
          open.map = [startLine, Math.min(closingLine + 1, endLine)]
          pushProps(open, opening, location)

          const previousLineMax = state.lineMax
          state.lineMax = closingLine
          state.md.block.tokenize(state, startLine + 1, closingLine)
          state.lineMax = previousLineMax

          const close = state.push('mdc_block_close', opening.canonicalName, -1)
          close.block = true
          close.map = open.map
          state.line = closingLine < endLine ? closingLine + 1 : endLine
          return true
        },
        { alt: ['paragraph', 'reference', 'blockquote'] },
      )

      markdown.inline.ruler.before('text', TOKEN_MARKER, (state: InlineState, silent: boolean) => {
        const head = isAngleCandidate(state.src, state.pos)
        if (!head) return false
        const location = inlineLocation(state)
        const opening = parseAngleTag(state.src, state.pos, location)
        if (!opening) {
          if (!options.autoClose) syntaxError('invalid_prop', `Component <${head.name}> is incomplete.`, location)
          return false
        }
        if (opening.closing) {
          if (!options.autoClose) {
            syntaxError('orphan_close', `Closing tag </${opening.name}> has no opening tag.`, location)
          }
          return false
        }
        if (silent) return true

        const marker = {
          block: 0 as const,
          sourceName: opening.name,
          line: location.line,
          column: location.column,
          openingTag: `<${opening.name}>`,
        }

        if (opening.selfClosing) {
          state.push('mdc_inline_component', opening.canonicalName, 0)
          const props = state.push('mdc_inline_props', '', 0)
          for (const [name, value] of opening.props) props.attrSet(name, value)
          props.attrSet(TOKEN_MARKER, JSON.stringify(marker))
          state.pos = opening.end
          return true
        }

        const closing = findInlineClose(state, opening)
        let contentEnd = closing?.contentEnd ?? -1
        let closingEnd = closing?.closingEnd ?? -1
        if (!closing) {
          if (!options.autoClose) syntaxError('unclosed_tag', `Component <${opening.name}> is not closed.`, location)
          contentEnd = state.posMax
          closingEnd = state.posMax
        }

        state.push('mdc_inline_component', opening.canonicalName, 1)
        const previousMaximum = state.posMax
        state.pos = opening.end
        state.posMax = contentEnd
        state.md.inline.tokenize(state)
        state.posMax = previousMaximum
        state.pos = closingEnd
        state.push('mdc_inline_component', opening.canonicalName, -1)
        const props = state.push('mdc_inline_props', '', 0)
        for (const [name, value] of opening.props) props.attrSet(name, value)
        props.attrSet(TOKEN_MARKER, JSON.stringify(marker))
        return true
      })
    },
  ],
  post: ({ tree }) => {
    const locations = new WeakMap<object, ParseLocation>()
    const mark = (node: Node): void => {
      if (typeof node === 'string' || node[0] === null) return
      const rawMarker = node[1][TOKEN_MARKER]
      const marker = parseTokenMarker(rawMarker)
      if (marker) {
        const { [TOKEN_MARKER]: _tokenMarker, ...props } = node[1]
        node[1] = props
        node[1].$ = { syntax: 'angle', block: marker.block, sourceName: marker.sourceName } as ElementNode[1]['$']
        locations.set(node, marker)
      }
      for (const child of node.slice(2) as Node[]) mark(child)
    }
    for (const node of tree.nodes) mark(node)

    if (!options.autoClose) {
      const validate = (node: Node, directAngleParent = false): void => {
        if (typeof node === 'string' || node[0] === null) return
        const metadata = angleMetadata(node)
        const location = locations.get(node) ?? { line: 1, column: 1, openingTag: `<${node[0]}>` }
        if (metadata?.sourceName === 'template' && !directAngleParent) {
          syntaxError('misplaced_slot', 'Named slots must be direct children of an angle component.', location)
        }
        const isAngleComponent = Boolean(metadata && metadata.sourceName !== 'template')
        if (isAngleComponent) {
          const seen = new Set<string>()
          let explicitDefault = false
          let implicitDefault = false
          for (const child of node.slice(2) as Node[]) {
            if (typeof child !== 'string' && child[0] !== null) {
              const childMetadata = angleMetadata(child)
              if (childMetadata?.sourceName === 'template' && typeof child[1].name === 'string') {
                if (seen.has(child[1].name)) {
                  syntaxError(
                    'duplicate_slot',
                    `Named slot "${child[1].name}" is duplicated.`,
                    locations.get(child) ?? location,
                  )
                }
                seen.add(child[1].name)
                if (child[1].name === 'default') explicitDefault = true
                continue
              }
            }
            if (isMeaningfulImplicitNode(child)) implicitDefault = true
          }
          if (explicitDefault && implicitDefault) {
            syntaxError(
              'mixed_default_slot',
              'Explicit and implicit default slot content cannot be mixed.',
              location,
            )
          }
        }
        for (const child of node.slice(2) as Node[]) validate(child, isAngleComponent)
      }
      for (const node of tree.nodes) validate(node)
    }
  },
}))()

const isMeaningfulImplicitNode = (node: Node): boolean => {
  if (typeof node === 'string') return Boolean(node.trim())
  return node[0] !== null
}

const parseTokenMarker = (value: unknown): TokenMarker | undefined => {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
  const marker = parsed as Record<string, unknown>
  if (
    Object.keys(marker).sort().join(',') !== 'block,column,line,openingTag,sourceName' ||
    (marker.block !== 0 && marker.block !== 1) ||
    typeof marker.sourceName !== 'string' ||
    !Number.isSafeInteger(marker.line) || !Number.isSafeInteger(marker.column) ||
    typeof marker.openingTag !== 'string'
  ) return undefined
  return marker as unknown as TokenMarker
}

const angleMetadata = (node: ElementNode) => {
  const metadata = node[1].$ as Record<string, unknown> | undefined
  return metadata && Object.keys(metadata).sort().join(',') === 'block,sourceName,syntax' &&
    metadata.syntax === 'angle' &&
    (metadata.block === 0 || metadata.block === 1) &&
    typeof metadata.sourceName === 'string' &&
    canonicalizePortableComponentName(metadata.sourceName) === node[0]
    ? metadata as { syntax: 'angle'; block: 0 | 1; sourceName: string }
    : undefined
}

const renderAngleProps = (props: ElementNode[1]) => Object.entries(props)
  .filter(([name]) => name !== '$')
  .map(([name, value]) => {
    if (value === true) return ` ${name}`
    if (typeof value === 'string') return ` ${name}="${escapeAttribute(value)}"`
    return ` :${name}="${escapeAttribute(JSON.stringify(value))}"`
  })
  .join('')

export const angleComponentRenderer: ConditionalNodeHandler = {
  match: node => Boolean(angleMetadata(node)),
  handler: async (node, state) => {
    const metadata = angleMetadata(node)
    if (!metadata) return ''
    if (metadata.sourceName === 'template' && typeof node[1].name === 'string') {
      const content = (await state.flow(node, state)).trimEnd()
      return `<template #${node[1].name}>\n${content}\n</template>${state.context.blockSeparator}`
    }
    const props = renderAngleProps(node[1])
    if (node.length === 2) return `<${metadata.sourceName}${props} />${metadata.block ? state.context.blockSeparator : ''}`
    const rendered = await state.flow(node, state)
    if (metadata.block === 0) return `<${metadata.sourceName}${props}>${rendered}</${metadata.sourceName}>`
    const content = rendered.trimEnd()
    return `<${metadata.sourceName}${props}>\n${content}\n</${metadata.sourceName}>${state.context.blockSeparator}`
  },
}
