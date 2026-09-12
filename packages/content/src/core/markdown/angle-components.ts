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
  | 'invalid_binding'
  | 'invalid_prop'
  | 'mismatched_tag'
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

const NAME = /^[A-Z][A-Z0-9_.-]*/i
const PROP_NAME = /^:?[A-Z_][A-Z0-9_.-]*/i

const isExplicitComponentName = (name: string) =>
  /^[A-Z]/.test(name) || (!HTML_TAGS.has(name) && name !== 'template')

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

type BlockState = {
  src: string
  bMarks: number[]
  eMarks: number[]
  tShift: number[]
  sCount: number[]
  blkIndent: number
  line: number
  lineMax: number
  md: { block: { tokenize: (state: BlockState, start: number, end: number) => void } }
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
  md: { inline: { tokenize: (state: InlineState) => void } }
  push: (type: string, tag: string, nesting: number) => AngleToken
}

const lineText = (state: BlockState, line: number) =>
  state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line])

const parseWholeLineTag = (state: BlockState, line: number): ParsedTag | undefined => {
  if ((state.sCount[line] ?? 0) - state.blkIndent >= 4) return undefined
  const source = lineText(state, line)
  const location = { line: line + 1, column: (state.tShift[line] ?? 0) + 1, openingTag: source.trim() }
  const start = source.search(/\S/)
  if (start < 0) return undefined
  const parsed = parseAngleTag(source, start, location)
  if (!parsed || source.slice(parsed.end).trim()) return undefined
  return parsed
}

function findBlockClose(
  state: BlockState,
  opening: ParsedTag,
  startLine: number,
  endLine: number,
  autoClose: boolean,
): number {
  const stack = [opening.name]
  let fence: string | undefined
  let inComment = false
  for (let line = startLine + 1; line < endLine; line += 1) {
    const text = lineText(state, line)
    const trimmed = text.trim()
    if (inComment) {
      if (trimmed.includes('-->')) inComment = false
      continue
    }
    if (trimmed.startsWith('<!--')) {
      if (!trimmed.includes('-->')) inComment = true
      continue
    }
    const fenceMatch = /^(?:`{3,}|~{3,})/.exec(trimmed)
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[0][0]
      else if (fence === fenceMatch[0][0]) fence = undefined
      continue
    }
    if (fence) continue
    const tag = parseWholeLineTag(state, line)
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

function pushProps(token: AngleToken, parsed: ParsedTag, block: 0 | 1) {
  for (const [name, value] of parsed.props) token.attrSet(name, value)
  if (parsed.slotName) token.attrSet('name', parsed.slotName)
  token.attrSet(TOKEN_MARKER, JSON.stringify({ block, sourceName: parsed.name }))
}

export const angleComponents = (options: { autoClose: boolean }) => defineComarkPlugin(() => ({
  name: 'ginko-angle-components',
  markdownItPlugins: [
    (markdown) => {
      markdown.block.ruler.before(
        'html_block',
        TOKEN_MARKER,
        (state: BlockState, startLine: number, endLine: number, silent: boolean) => {
          const opening = parseWholeLineTag(state, startLine)
          if (!opening || opening.closing || (!isExplicitComponentName(opening.name) && opening.name !== 'template')) return false
          if (opening.name === 'template' && !opening.slotName) return false
          if (silent) return true

          if (opening.selfClosing) {
            const token = state.push('mdc_block_open', opening.canonicalName, 0)
            token.block = true
            token.map = [startLine, startLine + 1]
            pushProps(token, opening, 1)
            state.line = startLine + 1
            return true
          }

          const closingLine = findBlockClose(state, opening, startLine, endLine, options.autoClose)
          const open = state.push('mdc_block_open', opening.name === 'template' ? 'template' : opening.canonicalName, 1)
          open.block = true
          open.map = [startLine, Math.min(closingLine + 1, endLine)]
          pushProps(open, opening, 1)

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
        const location = { line: 1, column: state.pos + 1, openingTag: state.src.slice(state.pos, state.pos + 80) }
        const opening = parseAngleTag(state.src, state.pos, location)
        if (!opening || opening.closing || !isExplicitComponentName(opening.name)) return false
        if (silent) return true

        if (opening.selfClosing) {
          state.push('mdc_inline_component', opening.canonicalName, 0)
          const props = state.push('mdc_inline_props', '', 0)
          for (const [name, value] of opening.props) props.attrSet(name, value)
          props.attrSet(TOKEN_MARKER, JSON.stringify({ block: 0, sourceName: opening.name }))
          state.pos = opening.end
          return true
        }

        const stack = [opening.name]
        let cursor = opening.end
        let contentEnd = -1
        let closingEnd = -1
        while (cursor < state.posMax) {
          const next = state.src.indexOf('<', cursor)
          if (next < 0) break
          const tag = parseAngleTag(state.src, next, location)
          if (!tag || (!isExplicitComponentName(tag.name) && tag.name !== opening.name)) {
            cursor = next + 1
            continue
          }
          if (!tag.closing && !tag.selfClosing) stack.push(tag.name)
          if (tag.closing) {
            const expected = stack[stack.length - 1]
            if (expected !== tag.name) syntaxError('mismatched_tag', `Expected </${expected}> but found </${tag.name}>.`, location)
            stack.pop()
            if (!stack.length) {
              contentEnd = next
              closingEnd = tag.end
              break
            }
          }
          cursor = tag.end
        }
        if (contentEnd < 0) {
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
        props.attrSet(TOKEN_MARKER, JSON.stringify({ block: 0, sourceName: opening.name }))
        return true
      })
    },
  ],
  post: ({ tree }) => {
    const mark = (node: Node): void => {
      if (typeof node === 'string' || node[0] === null) return
      const rawMarker = node[1][TOKEN_MARKER]
      const marker = parseTokenMarker(rawMarker)
      if (marker) {
        const { [TOKEN_MARKER]: _tokenMarker, ...props } = node[1]
        node[1] = props
        node[1].$ = { syntax: 'angle', block: marker.block, sourceName: marker.sourceName } as ElementNode[1]['$']
      }
      for (const child of node.slice(2) as Node[]) mark(child)
    }
    for (const node of tree.nodes) mark(node)
  },
}))()

const parseTokenMarker = (value: unknown): { block: 0 | 1; sourceName: string } | undefined => {
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
    Object.keys(marker).length !== 2 ||
    (marker.block !== 0 && marker.block !== 1) ||
    typeof marker.sourceName !== 'string'
  ) return undefined
  return { block: marker.block, sourceName: marker.sourceName }
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
    const content = (await state.flow(node, state)).trimEnd()
    if (metadata.block === 0) return `<${metadata.sourceName}${props}>${content}</${metadata.sourceName}>`
    return `<${metadata.sourceName}${props}>\n${content}\n</${metadata.sourceName}>${state.context.blockSeparator}`
  },
}
