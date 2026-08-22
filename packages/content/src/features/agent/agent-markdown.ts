import type { MarkdownNode, ParsedContent } from '../../types/content'
import type { AgentMetadataField, ContentCollectionConfig } from '../../types/config'
import { isSafePublicMarkdownUrl } from '../../cms-contract/render-policy'

export interface AgentMarkdownPublicSignals {
  search?: 'yes' | 'no'
  aiInput?: 'yes' | 'no'
  aiTrain?: 'yes' | 'no'
}

export interface ResolvedAgentMarkdownOptions {
  includeInIndex: boolean
  includeInFull: boolean
  metadata: AgentMetadataField[]
}

export interface AgentMarkdown {
  path: string
  markdownPath: string
  rawPath: string
  locale?: string
  collection: string
  title: string
  description: string
  markdown: string
  sourceFile?: string
  order?: number
  canonicalUrl: string
  lastModified?: string
  publicSignals?: AgentMarkdownPublicSignals
  metadataFields: string[]
  includeInIndex: boolean
  includeInFull: boolean
}

export type AgentMarkdownMeta = Omit<AgentMarkdown, 'markdown'>

/**
 * The single context the agent-markdown walker is a pure function of.
 *
 * It carries (a) the per-app serializer {@link AgentMarkdownRegistry} and
 * (b) the config-derived data the walker reads (markdown tag aliases, the
 * configured locales, and the default locale used for link prefixing), in
 * addition to the document coordinates and the per-node render helpers passed
 * to serializers. The walker holds no module-global state: everything it reads
 * arrives on this context, built by the runtime handlers from the resolved
 * content config.
 */
export interface AgentMarkdownContext {
  collection: string
  page: ParsedContent
  path: string
  locale?: string
  /** Per-app serializer registry the walker resolves component tags against. */
  registry: AgentMarkdownRegistry
  /** Component tag alias map (the resolved config's `markdown.tags`). */
  tagAliases: Record<string, string>
  /** Default locale used when prefixing localized links. */
  defaultLocale: string
  /** Configured locales used when prefixing localized links. */
  locales: string[]
  prop: (name: string) => string
  props: (node?: MarkdownNode) => Record<string, unknown>
  cleanProps: (node?: MarkdownNode) => Record<string, unknown>
  children: (node?: MarkdownNode) => string
  renderChildren: (node: MarkdownNode) => string
  renderNode: (node: MarkdownNode) => string
  blockquote: (value: string) => string
  jsonFence: (value: unknown) => string
  link: (label: string, href: string) => string
  omitted: (name: string, reason?: string) => string
  xmlComponent: (name: string, props?: Record<string, unknown>, children?: string) => string
}

/**
 * The environment slice the runtime handlers supply to the walker entrypoint;
 * the walker derives the per-node render helpers from it. Equivalent to an
 * {@link AgentMarkdownContext} without the closure-bound render helpers.
 */
export type AgentMarkdownRenderContext = Pick<
  AgentMarkdownContext,
  'collection' | 'page' | 'path' | 'locale' | 'registry' | 'tagAliases' | 'defaultLocale' | 'locales'
>

export type AgentMarkdownSerializer = (node: MarkdownNode, ctx: AgentMarkdownContext) => string | null | undefined
export type AgentMarkdownSerializerMap = Record<string, AgentMarkdownSerializer>
export interface AgentMarkdownSerializerRegistrationOptions {
  override?: boolean
}
export interface AgentMarkdownComponent {
  render: AgentMarkdownSerializer
}
export type AgentMarkdownComponentMap = Record<string, AgentMarkdownComponent>

/**
 * A per-app serializer registry. Each call to {@link createAgentMarkdownRegistry}
 * returns an isolated registry with its own backing store — there is no
 * module-global serializer map, so re-running module setup (dev HMR) yields a
 * fresh registry instead of accumulating or colliding with prior registrations.
 */
export interface AgentMarkdownRegistry {
  register: (
    name: string,
    serializer: AgentMarkdownSerializer,
    options?: AgentMarkdownSerializerRegistrationOptions
  ) => void
  registerMany: (
    entries: AgentMarkdownSerializerMap,
    options?: AgentMarkdownSerializerRegistrationOptions
  ) => void
  registerComponent: (
    name: string,
    component: AgentMarkdownComponent,
    options?: AgentMarkdownSerializerRegistrationOptions
  ) => void
  registerComponents: (
    entries: AgentMarkdownComponentMap,
    options?: AgentMarkdownSerializerRegistrationOptions
  ) => void
  clear: () => void
  get: (name: string) => AgentMarkdownSerializer | undefined
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const getMarkdownProp = (node: MarkdownNode, name: string) => {
  const props = isRecord(node.props) ? node.props : {}
  const value = props[name]
  return typeof value === 'string' ? value : ''
}

export const renderMarkdownChildren = (node: MarkdownNode, ctx: AgentMarkdownContext) =>
  ctx.renderChildren(node)

export const blockquoteMarkdown = (value: string) =>
  value.trim().split('\n').map(line => line ? `> ${line}` : '>').join('\n')

export const escapeMarkdownLinkLabel = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')

const escapeMarkdownLinkHref = (value: string) =>
  value.replace(/\)/g, '%29').replace(/\s/g, '%20')

export const linkMarkdown = (label: string, href: string) => {
  const resolvedLabel = label || href
  if (!href || !isSafePublicMarkdownUrl(href)) return escapeMarkdownLinkLabel(resolvedLabel)
  return `[${escapeMarkdownLinkLabel(resolvedLabel)}](${escapeMarkdownLinkHref(href)})`
}

export const imageMarkdown = (alt: string, src: string) => {
  if (!src || !isSafePublicMarkdownUrl(src, 'asset')) return escapeMarkdownLinkLabel(alt || src)
  return `![${escapeMarkdownLinkLabel(alt)}](${escapeMarkdownLinkHref(src)})`
}

export const jsonFenceMarkdown = (value: unknown) =>
  `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``

const xmlNamePattern = /^[a-z][\w.:-]*$/i

const safeXmlName = (name: string) =>
  xmlNamePattern.test(name) ? name : 'component'

const escapeXmlAttribute = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

const isScalarXmlAttributeValue = (value: unknown) =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

const shouldDropAgentProp = (name: string) => {
  const normalized = name.trim()
  const sensitive = normalized.toLowerCase()
  return !normalized
    || normalized === 'class'
    || normalized === 'style'
    || normalized === 'key'
    || normalized === 'ref'
    || normalized.startsWith('v-')
    || normalized.startsWith('@')
    || normalized.startsWith('on')
    || normalized.startsWith('data-')
    || normalized.startsWith('aria-')
    || /token|secret|password|passwd|credential|authorization|apikey|api-key|clientsecret|client-secret|privatekey|private-key|accesskey|access-key/i.test(sensitive)
}

const normalizeAgentPropName = (name: string) => {
  const normalized = name.trim()
  if (normalized.startsWith(':')) return normalized.slice(1)
  if (normalized.startsWith('v-bind:')) return normalized.slice('v-bind:'.length)
  return normalized
}

const cleanAgentPropValue = (value: unknown): unknown => {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value)) {
    const clean = value
      .map(entry => cleanAgentPropValue(entry))
      .filter(entry => entry !== undefined)
    return clean.length ? clean : undefined
  }
  if (isRecord(value)) {
    const clean = cleanPropsObject(value)
    return Object.keys(clean).length ? clean : undefined
  }
  return value
}

export const cleanPropsObject = (props: unknown) => {
  if (!isRecord(props)) return {}
  const clean: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(props)) {
    const normalizedName = normalizeAgentPropName(name)
    const cleanedValue = cleanAgentPropValue(value)
    if (shouldDropAgentProp(normalizedName) || cleanedValue === undefined) continue
    if (!(normalizedName in clean) || normalizedName === name.trim()) {
      Object.defineProperty(clean, normalizedName, {
        value: cleanedValue,
        enumerable: true,
        configurable: true,
        writable: true
      })
    }
  }
  return clean
}

export const xmlComponentMarkdown = (
  name: string,
  props: Record<string, unknown> = {},
  children = ''
) => {
  const tagName = safeXmlName(name)
  const cleanProps = cleanPropsObject(props)
  const attrs: string[] = []
  const complexProps: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(cleanProps)) {
    if (!xmlNamePattern.test(key)) {
      Object.defineProperty(complexProps, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true
      })
      continue
    }
    if (isScalarXmlAttributeValue(value)) {
      attrs.push(`${key}="${escapeXmlAttribute(String(value))}"`)
      continue
    }
    Object.defineProperty(complexProps, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    })
  }

  const attrText = attrs.length ? ` ${attrs.join(' ')}` : ''
  const bodyParts = [
    Object.keys(complexProps).length ? jsonFenceMarkdown(complexProps) : '',
    children.trim()
  ].filter(Boolean)

  if (!bodyParts.length) return `<${tagName}${attrText} />`

  return `<${tagName}${attrText}>\n${bodyParts.join('\n\n')}\n</${tagName}>`
}

export const defineAgentMarkdownComponent = (component: AgentMarkdownComponent) => component

/**
 * Create an isolated per-app serializer registry. The backing store is local to
 * the returned registry — two registries never share serializers — which is what
 * makes agent markdown serialization safe under dev HMR and across concurrent
 * apps. Registration/precedence semantics match the historical global registry:
 * re-registering the same serializer under a name is a no-op, a different one
 * throws unless `{ override: true }`.
 */
export const createAgentMarkdownRegistry = (): AgentMarkdownRegistry => {
  const serializers = new Map<string, AgentMarkdownSerializer>()

  const register = (
    name: string,
    serializer: AgentMarkdownSerializer,
    options: AgentMarkdownSerializerRegistrationOptions = {}
  ) => {
    const existing = serializers.get(name)
    if (existing === serializer && !options.override) return
    if (existing && !options.override) {
      throw new Error(
        `Agent Markdown serializer "${name}" is already registered. ` +
        'Use { override: true } only when replacing an existing serializer intentionally.'
      )
    }
    serializers.set(name, serializer)
  }

  const registerComponent = (
    name: string,
    component: AgentMarkdownComponent,
    options: AgentMarkdownSerializerRegistrationOptions = {}
  ) => register(name, component.render, options)

  return {
    register,
    registerMany: (entries, options) => {
      for (const [name, serializer] of Object.entries(entries)) register(name, serializer, options)
    },
    registerComponent,
    registerComponents: (entries, options) => {
      for (const [name, component] of Object.entries(entries)) registerComponent(name, component, options)
    },
    clear: () => serializers.clear(),
    get: name => serializers.get(name)
  }
}

export const resolveAgentMarkdownOptions = (
  collection: ContentCollectionConfig | undefined
): ResolvedAgentMarkdownOptions | null => {
  if (!collection || collection.type === 'data') return null
  const value = collection.agent?.markdown
  if (value === true) {
    return {
      includeInIndex: true,
      includeInFull: true,
      metadata: []
    }
  }
  if (!value || !isRecord(value)) return null
  return {
    includeInIndex: value.includeInIndex !== false,
    includeInFull: value.includeInFull !== false,
    metadata: Array.isArray(value.metadata)
      ? value.metadata.filter((field): field is AgentMetadataField => typeof field === 'string' && field.length > 0)
      : []
  }
}
