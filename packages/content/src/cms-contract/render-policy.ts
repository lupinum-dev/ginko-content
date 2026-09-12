import type { MarkdownNode, MarkdownRoot } from '../types/content.js'
import type {
  PortableComponentPolicy,
  PortableComponentPolicyV2,
} from './types.js'
import {
  isNormalizedTaskCheckboxProps,
  isNormalizedMathProps,
  isNormalizedMermaidProps,
  isSafeCodeHighlights,
  isSafeTableAlignmentStyle,
} from '../core/markdown/normalize-comark.js'
import { BUILTIN_MARKDOWN_RENDER_CONTRACTS } from '../core/markdown/builtin-render-contracts.js'
import { HTML_TAGS } from '../core/markdown/html-tags.js'
import { canonicalizePortableComponentName } from '../core/markdown/component-name.js'

export { canonicalizePortableComponentName } from '../core/markdown/component-name.js'

export type PublicMarkdownIssueCode =
  | 'invalid_node'
  | 'unsafe_tag'
  | 'unknown_component'
  | 'unsafe_prop'
  | 'unknown_prop'
  | 'missing_prop'
  | 'invalid_prop_value'
  | 'invalid_nesting'
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
  pre: new Set(['language', 'filename', 'meta', 'highlights']),
  td: new Set(['colspan', 'rowspan', 'headers']),
  th: new Set(['colspan', 'rowspan', 'headers', 'scope']),
  time: new Set(['datetime']),
}

const URL_PROPS = new Set(['href', 'src', 'cite'])
const UNSUPPORTED_NETWORK_PROPS = new Set(['ping', 'srcset'])
const FORBIDDEN_PROPS = new Set([
  '__proto__', 'prototype', 'constructor', 'innerhtml', 'textcontent', 'is', 'as',
  'style', 'ref', 'key',
])

const BUILTIN_RENDER_TAGS: ReadonlySet<string> = new Set(
  Object.values(BUILTIN_MARKDOWN_RENDER_CONTRACTS).map(contract => contract.tag),
)

/** Names authored component policies may never claim. */
export const isReservedPortableComponentName = (value: string): boolean => {
  const name = canonicalizePortableComponentName(value)
  const nativeName = value.toLowerCase()
  return nativeName === 'template' || ACTIVE_TAGS.has(nativeName) || BUILTIN_RENDER_TAGS.has(name)
}

/** Canonical names supported by Comark MDC and Vue component resolution. */
export const isValidPortableComponentName = (value: string): boolean =>
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value)

/** Internal canonical lookup shared by render validation and portable asset traversal. */
export const indexPortableComponentPolicies = (policy: PortableComponentPolicy) => new Map(
  Object.entries(policy.components)
    .map(([name, component]) => [canonicalizePortableComponentName(name), component] as const),
)

/** Package-private grammar used only while resolving stored portable assets. */
export const isStoredPortableAssetIdentity = (value: string): boolean =>
  /^[a-z0-9;:_-]{1,512}$/i.test(value) && !/^(?:javascript|vbscript|data|file|https?):/i.test(value)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isStructuredJsonValue = (value: unknown): boolean => {
  if (value === null) return true
  if (typeof value !== 'object') return false
  const ancestors = new Set<object>()
  const visit = (candidate: unknown): boolean => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean') return true
    if (typeof candidate === 'number') return Number.isFinite(candidate)
    if (typeof candidate !== 'object' || ancestors.has(candidate)) return false
    ancestors.add(candidate)
    try {
      if (Array.isArray(candidate)) return candidate.every(visit)
      if (!isRecord(candidate)) return false
      const prototype = Object.getPrototypeOf(candidate)
      return (prototype === Object.prototype || prototype === null) &&
        Object.entries(candidate).every(([key, child]) =>
          !FORBIDDEN_PROPS.has(key.toLowerCase()) && visit(child),
        )
    } finally {
      ancestors.delete(candidate)
    }
  }
  return visit(value)
}

const validateV2PropValue = (
  value: unknown,
  policy: PortableComponentPolicyV2['components'][string]['props'][string],
): boolean => {
  const matches =
    (typeof value === 'string' && policy.types.includes('string')) ||
    (typeof value === 'number' && Number.isFinite(value) && policy.types.includes('number')) ||
    (typeof value === 'boolean' && policy.types.includes('boolean')) ||
    (isStructuredJsonValue(value) && policy.types.includes('json')) ||
    (typeof value === 'string' && value.length > 0 && policy.types.includes('asset'))
  if (!matches) return false
  if (policy.allowedValues === null || isStructuredJsonValue(value)) return true
  return policy.allowedValues.includes(value as string | number | boolean)
}

const isSafeBindingValue = (value: unknown): boolean => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isSafeBindingValue)
  if (!isRecord(value)) return false
  return Object.entries(value).every(
    ([key, child]) => !FORBIDDEN_PROPS.has(key.toLowerCase()) && isSafeBindingValue(child),
  )
}

const SHIKI_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const SHIKI_STYLE_VALUES: Record<string, RegExp> = {
  // Shiki marks inline code with `display: inline`; @shikijs/transformers marks
  // highlighted and diff lines with `display: inline-block`. Nothing else is emitted,
  // so nothing else is accepted.
  display: /^(?:inline|inline-block)$/,
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
  // Stable Content references are resolved by the same graph-backed render
  // boundary for filesystem and CMS providers. They are links, never asset
  // identities, and keeping them in portable MDC preserves the authored
  // source without regex rewriting code examples or component props.
  if (kind === 'href' && /^\$[^\s\\?#]+(?:#[^\s\\]*)?$/u.test(input)) return true
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

function validateMarkdownAst(
  value: unknown,
  policy: PortableComponentPolicy,
  allowStoredAssets: boolean,
): PublicMarkdownValidationResult {
  const issues: PublicMarkdownIssue[] = []
  const report = (
    code: PublicMarkdownIssueCode,
    path: Array<string | number>,
    message: string,
  ) => issues.push({ code, path, message })
  const components = indexPortableComponentPolicies(policy)
  type ComponentPolicy = PortableComponentPolicy['components'][string]
  const v2 = 'version' in policy && policy.version === 2

  const validatePropInvariant = (
    tag: string,
    name: string,
    value: unknown,
    path: Array<string | number>,
    component: ComponentPolicy | undefined,
  ) => {
    const declared = component?.props[name]
    const declaredAsAsset = declared && (
      ('type' in declared && declared.type === 'asset') ||
      ('types' in declared && declared.types.length === 1 && declared.types[0] === 'asset')
    )
    if (declaredAsAsset && typeof value === 'string') {
      const storedAsset = allowStoredAssets && isStoredPortableAssetIdentity(value)
      if (!storedAsset && !isSafePublicMarkdownUrl(value, 'asset')) {
        report('unsafe_url', path, `Component property "${name}" contains an unsafe URL.`)
      }
    }
    // A component policy may claim a passive native name such as `a` or
    // `aside`, but its rendered output can still forward native properties.
    // Keep the native-tag safety invariants active across that collision.
    if (!HTML_TAGS.has(tag)) return
    const lower = name.toLowerCase()
    if (tag === 'pre' && (name === 'language' || name === 'filename' || name === 'meta') && typeof value !== 'string') {
      report('invalid_prop_value', path, `HTML property "${name}" on <pre> must be a string.`)
    }
    if (tag === 'pre' && name === 'highlights' && !isSafeCodeHighlights(value)) {
      report('invalid_prop_value', path, 'HTML property "highlights" on <pre> contains invalid line numbers.')
    }
    if (tag === 'pre' && name === 'meta' && typeof value === 'string' && value.length > 2048) {
      report('invalid_prop_value', path, 'HTML property "meta" on <pre> is too long.')
    }
    if (UNSUPPORTED_NETWORK_PROPS.has(lower)) {
      report('unsafe_prop', path, `Native network property "${name}" is not supported by the portable policy.`)
      return
    }
    if (!URL_PROPS.has(lower)) return
    if (typeof value !== 'string') {
      report('invalid_prop_value', path, `HTML URL property "${name}" must be a string.`)
      return
    }
    if (declaredAsAsset) return
    const storedAsset = allowStoredAssets &&
      tag === 'img' && lower === 'src' &&
      isStoredPortableAssetIdentity(value)
    const kind = lower === 'src' ? 'asset' : 'href'
    if (!storedAsset && !isSafePublicMarkdownUrl(value, kind)) {
      report('unsafe_url', path, `Property "${name}" contains an unsafe URL.`)
    }
  }

  const validateProps = (
    node: MarkdownNode,
    path: Array<string | number>,
    component: ComponentPolicy | undefined,
    native: boolean,
  ) => {
    const props = node.props ?? {}
    if (!isRecord(props)) {
      report('invalid_node', [...path, 'props'], 'Node props must be an object.')
      return
    }
    const tag = String(node.tag).toLowerCase()
    for (const [name, propValue] of Object.entries(props)) {
      const propPath = [...path, 'props', name]
      const lower = name.toLowerCase()
      if (name === '$') {
        if (!isSupportedParserMetadata(propValue)) report('unsafe_prop', propPath, 'Parser metadata is malformed.')
        continue
      }
      if (name === 'style' && tag === 'span' && isSafeShikiStyle(propValue)) continue
      if ((tag === 'th' || tag === 'td') && name === 'style' && isSafeTableAlignmentStyle(propValue)) continue
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
      validatePropInvariant(tag, name, propValue, propPath, component)
      if (component) {
        const declared = component.props[name]
        if (!declared) {
          report('unknown_prop', propPath, `Component property "${name}" is not declared.`)
          continue
        }
        const valid = 'types' in declared
          ? validateV2PropValue(propValue, declared)
          : declared.type === 'json' ||
            (declared.type === 'asset' && typeof propValue === 'string' && propValue.length > 0) ||
            (declared.type !== 'asset' && typeof propValue === declared.type)
        if (!valid) report('invalid_prop_value', propPath, `Component property "${name}" has the wrong type.`)
        continue
      }
      const allowed = native && (
        COMMON_HTML_PROPS.has(name) ||
        name.startsWith('aria-') ||
        name.startsWith('data-') ||
        HTML_PROPS[tag]?.has(name)
      )
      if (!allowed) {
        report('unknown_prop', propPath, `HTML property "${name}" is not allowed on <${tag}>.`)
        continue
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

  const visit = (
    node: unknown,
    path: Array<string | number>,
    parentComponent?: { name: string; policy: ComponentPolicy },
    directParentComponent?: { name: string; policy: ComponentPolicy },
  ): void => {
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
    const normalizedTag = canonicalizePortableComponentName(node.tag)
    const nativeTag = node.tag.toLowerCase()
    if (nativeTag === 'template') {
      if (node.tag !== 'template') {
        report('unsafe_tag', [...path, 'tag'], 'Named slot template tags must use the canonical lowercase spelling.')
        node.children.forEach((child, index) => visit(child, [...path, 'children', index]))
        return
      }
      const props = node.props ?? {}
      const slotName = isRecord(props) && Object.keys(props).length === 1 && typeof props.name === 'string'
        ? props.name
        : undefined
      if (!directParentComponent || !slotName || !directParentComponent.policy.slots.includes(slotName)) {
        report('unsafe_tag', [...path, 'tag'], 'Named slot templates must be direct children of a component and declare an allowed slot name.')
      }
      node.children.forEach((child, index) => visit(child, [...path, 'children', index], parentComponent))
      return
    }
    const metadata = isRecord(node.props) ? node.props.$ : undefined
    const explicitComponent = isComponentMetadata(metadata)
    const classification = classifyPortableMarkdownElement(node as Pick<MarkdownNode, 'tag' | 'props'>, policy)
    const component = classification.kind === 'component' ? components.get(classification.name) : undefined
    const native = classification.kind === 'html'
    if (
      explicitComponent && component && isRecord(metadata) &&
      ((metadata.block === 1 && component.kind !== 'block') || (metadata.block === 0 && component.kind !== 'inline'))
    ) {
      report('invalid_node', path, `Component <${node.tag}> is used with the wrong block or inline form.`)
    }
    if (component) {
      if (v2 && 'allowedParents' in component) {
        if (component.allowedParents && (!parentComponent || !component.allowedParents.includes(parentComponent.name))) {
          report('invalid_nesting', path, `Component <${node.tag}> is outside its allowed parent.`)
        }
        if (
          parentComponent && 'allowedChildren' in parentComponent.policy &&
          parentComponent.policy.allowedChildren &&
          !parentComponent.policy.allowedChildren.includes(normalizedTag)
        ) {
          report('invalid_nesting', path, `Component <${node.tag}> is not allowed inside <${parentComponent.name}>.`)
        }
      }
      const seenSlots = new Set<string>()
      let hasImplicitDefault = false
      let hasExplicitDefault = false
      for (const child of node.children) {
        if (!isRecord(child) || child.type !== 'element' || child.tag !== 'template') {
          if (!(isRecord(child) && child.type === 'text' && typeof child.value === 'string' && !child.value.trim())) {
            hasImplicitDefault = true
          }
          continue
        }
        const slotName = isRecord(child.props) && typeof child.props.name === 'string' ? child.props.name : undefined
        if (!slotName) continue
        if (seenSlots.has(slotName)) {
          report('invalid_node', [...path, 'children'], `Named slot "${slotName}" is duplicated.`)
        }
        seenSlots.add(slotName)
        if (slotName === 'default') hasExplicitDefault = true
      }
      if (hasImplicitDefault && hasExplicitDefault) {
        report('invalid_node', [...path, 'children'], 'Explicit and implicit default slot content cannot be mixed.')
      }
    }
    const exactMathNode = isNormalizedMathProps(node.props) &&
      node.children.length === 1 && isExactTextNode(node.children[0], (node.props as Record<string, unknown>).content)
    const exactMermaidNode = isNormalizedMermaidProps(node.props) && node.children.length === 0
    if (normalizedTag === BUILTIN_MARKDOWN_RENDER_CONTRACTS.math.tag && component && !exactMathNode) {
      report('invalid_prop_value', path, 'Generated Math node is malformed.')
    }
    if (normalizedTag === BUILTIN_MARKDOWN_RENDER_CONTRACTS.mermaid.tag && component && !exactMermaidNode) {
      report('invalid_prop_value', path, 'Generated Mermaid node is malformed.')
    }
    const isTaskCheckbox = nativeTag === 'input' &&
      isNormalizedTaskCheckboxProps(node.props) && node.children.length === 0
    if (ACTIVE_TAGS.has(nativeTag) && !isTaskCheckbox) {
      report('unsafe_tag', [...path, 'tag'], `Tag <${node.tag}> is not render-safe.`)
    } else if (explicitComponent && !component) {
      report('unknown_component', [...path, 'tag'], `Component <${node.tag}> is not registered.`)
    } else if (!isTaskCheckbox && native && !SAFE_HTML_TAGS.has(nativeTag)) {
      report('unsafe_tag', [...path, 'tag'], `Tag <${node.tag}> is not render-safe.`)
    } else if (!isTaskCheckbox && !native && !component) {
      report('unknown_component', [...path, 'tag'], `Component <${node.tag}> is not registered.`)
    }
    if (!isTaskCheckbox) validateProps(node as unknown as MarkdownNode, path, component, native)
    const currentComponent = component ? { name: normalizedTag, policy: component } : undefined
    node.children.forEach((child, index) => visit(
      child,
      [...path, 'children', index],
      currentComponent ?? parentComponent,
      currentComponent,
    ))
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

export function validatePublicMarkdownAst(
  value: unknown,
  policy: PortableComponentPolicy = { components: {} },
): PublicMarkdownValidationResult {
  return validateMarkdownAst(value, policy, false)
}

export function validateStoredPortableMarkdownAst(
  value: unknown,
  policy: PortableComponentPolicy,
): PublicMarkdownValidationResult {
  return validateMarkdownAst(value, policy, true)
}

export function assertPublicMarkdownAst(
  value: unknown,
  policy: PortableComponentPolicy = { components: {} },
): asserts value is MarkdownRoot {
  const result = validatePublicMarkdownAst(value, policy)
  if (!result.ok) throw new PublicMarkdownValidationError(result.issues)
}

const isExactTextNode = (value: unknown, expected: unknown): boolean =>
  isRecord(value) && Object.keys(value).length === 2 && value.type === 'text' && value.value === expected

const isComponentMetadata = (value: unknown): boolean =>
  isRecord(value) && Object.keys(value).sort().join(',') === 'block,component' &&
  value.component === 1 && (value.block === 0 || value.block === 1)

const isParsedComponentMetadata = (value: unknown): boolean =>
  isRecord(value) && (value.syntax === 'angle' || value.syntax === 'colon') &&
  (value.block === 0 || value.block === 1) && typeof value.sourceName === 'string'

const isHtmlMetadata = (value: unknown): boolean =>
  isRecord(value) && value.html === 1 && value.component === undefined

const isSupportedParserMetadata = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  if (isComponentMetadata(value)) return true
  const keys = Object.keys(value)
  return keys.length > 0 && keys.every(key => ['html', 'block', 'line'].includes(key)) &&
    value.component === undefined &&
    (value.html === undefined || value.html === 1) &&
    (value.block === undefined || value.block === 0 || value.block === 1) &&
    (value.line === undefined || Number.isSafeInteger(value.line))
}

export function classifyPortableMarkdownElement(
  node: Pick<MarkdownNode, 'tag' | 'props'>,
  policy: PortableComponentPolicy,
):
  | { kind: 'html'; name: string }
  | { kind: 'component'; name: string; form: 'block' | 'inline'; registered: boolean } {
  const name = canonicalizePortableComponentName(node.tag ?? '')
  const nativeName = String(node.tag ?? '').toLowerCase()
  const metadata = isRecord(node.props) ? node.props.$ : undefined
  const explicitComponent = isComponentMetadata(metadata) || isParsedComponentMetadata(metadata)
  const explicitHtml = isHtmlMetadata(metadata)
  const component = indexPortableComponentPolicies(policy).get(name)
  const registered = component !== undefined
  if (explicitHtml || (!explicitComponent && HTML_TAGS.has(nativeName) && !registered)) {
    return { kind: 'html', name: nativeName }
  }
  return {
    kind: 'component',
    name,
    form: explicitComponent && isRecord(metadata)
      ? metadata.block === 0 ? 'inline' : 'block'
      : component?.kind ?? 'block',
    registered,
  }
}
