import type { MarkdownNode, MarkdownRoot } from '../types/content.js'
import type { PortableComponentPolicyV1 } from './types.js'

export type PublicMarkdownIssueCode =
  | 'invalid_node'
  | 'unsafe_tag'
  | 'unknown_component'
  | 'unsafe_prop'
  | 'unknown_prop'
  | 'missing_prop'
  | 'invalid_prop_value'
  | 'unsafe_url'

export interface PublicMarkdownIssue {
  code: PublicMarkdownIssueCode
  path: Array<string | number>
  message: string
}

export type PublicMarkdownValidationResult =
  | { ok: true; value: MarkdownRoot }
  | { ok: false; issues: PublicMarkdownIssue[] }

export class PublicMarkdownValidationError extends Error {
  readonly issues: PublicMarkdownIssue[]

  constructor(issues: PublicMarkdownIssue[]) {
    super('Public Markdown AST is not render-safe.')
    this.name = 'PublicMarkdownValidationError'
    this.issues = issues
  }
}

const SAFE_HTML_TAGS = new Set([
  'a', 'abbr', 'address', 'article', 'aside', 'b', 'bdi', 'bdo', 'blockquote', 'br',
  'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'dd', 'del', 'details', 'dfn',
  'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'main',
  'mark', 'nav', 'ol', 'p', 'picture', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
])

const ACTIVE_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'canvas', 'form',
  'input', 'button', 'select', 'textarea', 'option', 'link', 'meta', 'base', 'html',
  'head', 'body', 'audio', 'video', 'source', 'track',
])

const COMMON_HTML_PROPS = new Set([
  'id', 'title', 'class', 'className', 'lang', 'dir', 'hidden', 'role', 'tabindex',
])

const HTML_PROPS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'download', 'hreflang']),
  blockquote: new Set(['cite']),
  col: new Set(['span']),
  data: new Set(['value']),
  del: new Set(['cite', 'datetime']),
  img: new Set(['src', 'alt', 'width', 'height', 'loading', 'decoding']),
  ins: new Set(['cite', 'datetime']),
  li: new Set(['value']),
  ol: new Set(['start', 'reversed', 'type']),
  pre: new Set(['language', 'filename']),
  td: new Set(['colspan', 'rowspan', 'headers']),
  th: new Set(['colspan', 'rowspan', 'headers', 'scope']),
  time: new Set(['datetime']),
}

const URL_PROPS = new Set(['href', 'src', 'cite'])
const FORBIDDEN_PROPS = new Set([
  '__proto__', 'prototype', 'constructor', 'innerhtml', 'textcontent', 'is', 'as',
  'style', 'ref', 'key',
])

const componentName = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_.\s]+/g, '-')
    .toLowerCase()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isSafeBindingValue = (value: unknown): boolean => {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isSafeBindingValue)
  if (!isRecord(value)) return false
  return Object.entries(value).every(
    ([key, child]) => !FORBIDDEN_PROPS.has(key.toLowerCase()) && isSafeBindingValue(child),
  )
}

const SHIKI_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const SHIKI_STYLE_VALUES: Record<string, RegExp> = {
  color: SHIKI_COLOR,
  '--shiki-light': SHIKI_COLOR,
  '--shiki-dark': SHIKI_COLOR,
  '--shiki-light-font-style': /^(?:normal|italic|oblique)$/,
  '--shiki-dark-font-style': /^(?:normal|italic|oblique)$/,
  '--shiki-light-font-weight': /^(?:normal|bold|[1-9]00)$/,
  '--shiki-dark-font-weight': /^(?:normal|bold|[1-9]00)$/,
  '--shiki-light-text-decoration': /^(?:none|underline|line-through)$/,
  '--shiki-dark-text-decoration': /^(?:none|underline|line-through)$/,
}

const isSafeShikiStyle = (value: unknown): boolean => {
  if (typeof value !== 'string') return false
  if (value.trim() === 'display: inline') return true
  const declarations = value.split(';')
  if (!declarations.length || declarations.some(declaration => !declaration)) return false
  const seen = new Set<string>()
  return declarations.every((declaration) => {
    const separator = declaration.indexOf(':')
    if (separator <= 0) return false
    const name = declaration.slice(0, separator).trim()
    const propertyValue = declaration.slice(separator + 1).trim()
    const pattern = SHIKI_STYLE_VALUES[name]
    if (!pattern || seen.has(name) || !pattern.test(propertyValue)) return false
    seen.add(name)
    return true
  })
}

export function isSafePublicMarkdownUrl(value: string, kind: 'href' | 'asset' = 'href'): boolean {
  const input = value.trim()
  const hasControlCharacter = Array.from(input).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (!input || input.startsWith('//') || input.includes('\\') || hasControlCharacter) return false
  if (kind === 'href' && input.startsWith('#')) return true
  try {
    if (input.startsWith('/') || input.startsWith('./') || input.startsWith('../')) {
      return new URL(input, 'https://ginko.invalid').origin === 'https://ginko.invalid'
    }
    const url = new URL(input)
    if (url.username || url.password) return false
    if (url.protocol === 'https:') return true
    return kind === 'href' && (url.protocol === 'mailto:' || url.protocol === 'tel:')
  } catch {
    return false
  }
}

export function validatePublicMarkdownAst(
  value: unknown,
  policy: PortableComponentPolicyV1 = { components: {} },
): PublicMarkdownValidationResult {
  const issues: PublicMarkdownIssue[] = []
  const report = (
    code: PublicMarkdownIssueCode,
    path: Array<string | number>,
    message: string,
  ) => issues.push({ code, path, message })
  const components = new Map(
    Object.entries(policy.components).map(([name, component]) => [componentName(name), component]),
  )

  const validateProps = (
    node: MarkdownNode,
    path: Array<string | number>,
    component: PortableComponentPolicyV1['components'][string] | undefined,
  ) => {
    const props = node.props ?? {}
    if (!isRecord(props)) {
      report('invalid_node', [...path, 'props'], 'Node props must be an object.')
      return
    }
    const tag = String(node.tag)
    for (const [name, propValue] of Object.entries(props)) {
      const propPath = [...path, 'props', name]
      const lower = name.toLowerCase()
      if (name === '$') {
        if (
          !isRecord(propValue) ||
          Object.keys(propValue).some((key) => !['html', 'block'].includes(key)) ||
          Object.values(propValue).some((child) => typeof child !== 'number')
        ) report('unsafe_prop', propPath, 'Parser metadata is malformed.')
        continue
      }
      if (name === 'style' && tag === 'span' && isSafeShikiStyle(propValue)) continue
      if (tag === 'blockquote' && name === 'data-alert') {
        if (
          typeof propValue !== 'string' ||
          !['note', 'tip', 'important', 'warning', 'caution'].includes(propValue)
        ) report('invalid_prop_value', propPath, 'Blockquote alert metadata is invalid.')
        continue
      }
      if (
        !name || /^on/i.test(name) || /^v-|^@|^:|^#/.test(name) ||
        FORBIDDEN_PROPS.has(lower)
      ) {
        report('unsafe_prop', propPath, `Property "${name}" is not render-safe.`)
        continue
      }
      if (!isSafeBindingValue(propValue)) {
        report('invalid_prop_value', propPath, `Property "${name}" is not JSON-safe.`)
        continue
      }
      if (component) {
        const declared = component.props[name]
        if (!declared) {
          report('unknown_prop', propPath, `Component property "${name}" is not declared.`)
          continue
        }
        const valid =
          declared.type === 'json' ||
          (declared.type === 'asset' && typeof propValue === 'string' && propValue.length > 0) ||
          (declared.type !== 'asset' && typeof propValue === declared.type)
        if (!valid) report('invalid_prop_value', propPath, `Component property "${name}" has the wrong type.`)
        else if (declared.type === 'asset' && !isSafePublicMarkdownUrl(propValue as string, 'asset')) {
          report('unsafe_url', propPath, `Component property "${name}" contains an unsafe URL.`)
        }
        continue
      }
      const allowed =
        COMMON_HTML_PROPS.has(name) ||
        name.startsWith('aria-') ||
        name.startsWith('data-') ||
        HTML_PROPS[tag]?.has(name)
      if (!allowed) {
        report('unknown_prop', propPath, `HTML property "${name}" is not allowed on <${tag}>.`)
        continue
      }
      if (tag === 'pre' && (name === 'language' || name === 'filename') && typeof propValue !== 'string') {
        report('invalid_prop_value', propPath, `HTML property "${name}" on <pre> must be a string.`)
        continue
      }
      if (URL_PROPS.has(lower) && typeof propValue === 'string') {
        const kind = lower === 'src' ? 'asset' : 'href'
        if (!isSafePublicMarkdownUrl(propValue, kind)) {
          report('unsafe_url', propPath, `Property "${name}" contains an unsafe URL.`)
        }
      }
    }
    if (component) {
      for (const [name, definition] of Object.entries(component.props)) {
        if (definition.required && !(name in props)) {
          report('missing_prop', [...path, 'props', name], `Required component property "${name}" is missing.`)
        }
      }
    }
  }

  const visit = (node: unknown, path: Array<string | number>): void => {
    if (!isRecord(node) || typeof node.type !== 'string') {
      report('invalid_node', path, 'Markdown nodes must be objects with a type.')
      return
    }
    if (node.type === 'text') {
      if (typeof node.value !== 'string') report('invalid_node', [...path, 'value'], 'Text nodes require a string value.')
      if (Object.keys(node).some((key) => !['type', 'value'].includes(key))) {
        report('invalid_node', path, 'Text nodes contain unsupported fields.')
      }
      return
    }
    if (node.type !== 'element' || typeof node.tag !== 'string' || !Array.isArray(node.children)) {
      report('invalid_node', path, 'Only text and element Markdown nodes are renderable.')
      return
    }
    if (Object.keys(node).some((key) => !['type', 'tag', 'props', 'children'].includes(key))) {
      report('invalid_node', path, 'Element nodes contain unsupported fields.')
    }
    const normalizedTag = componentName(node.tag)
    const component = components.get(normalizedTag)
    if (ACTIVE_TAGS.has(normalizedTag)) {
      report('unsafe_tag', [...path, 'tag'], `Tag <${node.tag}> is not render-safe.`)
    } else if (!SAFE_HTML_TAGS.has(normalizedTag) && !component) {
      report('unknown_component', [...path, 'tag'], `Component <${node.tag}> is not registered.`)
    }
    validateProps(node as unknown as MarkdownNode, path, component)
    node.children.forEach((child, index) => visit(child, [...path, 'children', index]))
  }

  if (!isRecord(value) || value.type !== 'root' || !Array.isArray(value.children)) {
    report('invalid_node', [], 'Markdown root must contain a children array.')
  } else {
    if (Object.keys(value).some((key) => !['type', 'children', 'props', 'toc'].includes(key))) {
      report('invalid_node', [], 'Markdown root contains unsupported fields.')
    }
    if (value.props !== undefined && (!isRecord(value.props) || Object.keys(value.props).length > 0)) {
      report('unsafe_prop', ['props'], 'Markdown root props must be empty.')
    }
    value.children.forEach((child, index) => visit(child, ['children', index]))
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: value as MarkdownRoot }
}

export function assertPublicMarkdownAst(
  value: unknown,
  policy: PortableComponentPolicyV1 = { components: {} },
): asserts value is MarkdownRoot {
  const result = validatePublicMarkdownAst(value, policy)
  if (!result.ok) throw new PublicMarkdownValidationError(result.issues)
}
