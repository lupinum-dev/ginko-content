import type { H3Event } from 'h3'
import { kebabCase, pascalCase } from 'scule'
import type { ContentQueryResponse } from '../../types/api'
import type { MarkdownNode, MarkdownRoot, ParsedContent } from '../../types/content'
import type { AgentMetadataField, ContentCollectionConfig, ContentCollectionHandle } from '../../types/config'
import { agentMarkdownPathForRoute, agentRawPathForRoute, normalizeAgentRoutePath } from '../agent-paths'
import { getCollectionPath } from '../query/routes'
import { getContentProvider } from './providers'
import { contentConfig } from './storage-access'

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
  canonicalUrl: string
  lastModified?: string
  publicSignals?: AgentMarkdownPublicSignals
  metadataFields: string[]
  includeInIndex: boolean
  includeInFull: boolean
}

export type AgentMarkdownMeta = Omit<AgentMarkdown, 'markdown'>

export interface AgentMarkdownContext {
  collection: string
  page: ParsedContent
  path: string
  locale?: string
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

export type AgentMarkdownSerializer = (node: MarkdownNode, ctx: AgentMarkdownContext) => string | null | undefined
export type AgentMarkdownSerializerMap = Record<string, AgentMarkdownSerializer>
export interface AgentMarkdownSerializerRegistrationOptions {
  override?: boolean
}
export interface AgentMarkdownComponent {
  render: AgentMarkdownSerializer
}
export type AgentMarkdownComponentMap = Record<string, AgentMarkdownComponent>

const serializers = new Map<string, AgentMarkdownSerializer>()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const defaultLocale = () => contentConfig().defaultLocale || contentConfig().locales?.[0] || contentConfig().agent?.site?.defaultLocale || 'en'

const configuredLocales = () => {
  const locales = contentConfig().agent?.site?.locales?.length
    ? contentConfig().agent?.site?.locales
    : contentConfig().locales
  return locales?.length ? locales : [defaultLocale()]
}

const prefixLocalizedHref = (path: string, locale?: string) => {
  const normalized = normalizeAgentRoutePath(path)
  if (!locale || locale === defaultLocale()) return normalized
  if (configuredLocales().some((candidate: string) => normalized === `/${candidate}` || normalized.startsWith(`/${candidate}/`))) return normalized
  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`
}

const isExternalHref = (href: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')

const routeMarkdownPathForHref = (href: string, locale?: string, currentPath = '/') => {
  const hash = href.match(/#.*$/)?.[0] || ''
  const withoutHash = href.replace(/#.*$/, '')
  if (!withoutHash) return href
  if (isExternalHref(withoutHash)) return href
  if (withoutHash.endsWith('.md')) return href
  const target = withoutHash.startsWith('/')
    ? prefixLocalizedHref(withoutHash, locale)
    : new URL(withoutHash, `https://agent.local${normalizeAgentRoutePath(currentPath)}`).pathname
  return `${agentRawPathForRoute(target)}${hash}`
}

export const getMarkdownProp = (node: MarkdownNode, name: string) => {
  const props = isRecord(node.props) ? node.props : {}
  const value = props[name]
  return typeof value === 'string' ? value : ''
}

export const renderMarkdownChildren = (node: MarkdownNode, ctx: AgentMarkdownContext) =>
  ctx.renderChildren(node)

export const blockquoteMarkdown = (value: string) =>
  value.trim().split('\n').map(line => line ? `> ${line}` : '>').join('\n')

const escapeMarkdownLinkLabel = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')

const escapeMarkdownLinkHref = (value: string) =>
  value.replace(/\)/g, '%29').replace(/\s/g, '%20')

const isSafeMarkdownHref = (href: string) => {
  if (!href) return false
  if (href.startsWith('//')) return false
  if (href.startsWith('/') || href.startsWith('#') || href.startsWith('./') || href.startsWith('../')) return true
  return /^(https?:|mailto:|tel:)/i.test(href)
}

export const linkMarkdown = (label: string, href: string) => {
  const resolvedLabel = label || href
  if (!href || !isSafeMarkdownHref(href)) return escapeMarkdownLinkLabel(resolvedLabel)
  return `[${escapeMarkdownLinkLabel(resolvedLabel)}](${escapeMarkdownLinkHref(href)})`
}

export const imageMarkdown = (alt: string, src: string) => {
  if (!src || !isSafeMarkdownHref(src)) return escapeMarkdownLinkLabel(alt || src)
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

const cleanPropsObject = (props: unknown) => {
  if (!isRecord(props)) return {}
  const clean: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(props)) {
    const normalizedName = normalizeAgentPropName(name)
    const cleanedValue = cleanAgentPropValue(value)
    if (shouldDropAgentProp(normalizedName) || cleanedValue === undefined) continue
    if (!(normalizedName in clean) || normalizedName === name.trim()) {
      clean[normalizedName] = cleanedValue
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
      complexProps[key] = value
      continue
    }
    if (isScalarXmlAttributeValue(value)) {
      attrs.push(`${key}="${escapeXmlAttribute(String(value))}"`)
      continue
    }
    complexProps[key] = value
  }

  const attrText = attrs.length ? ` ${attrs.join(' ')}` : ''
  const bodyParts = [
    Object.keys(complexProps).length ? jsonFenceMarkdown(complexProps) : '',
    children.trim()
  ].filter(Boolean)

  if (!bodyParts.length) return `<${tagName}${attrText} />`

  return `<${tagName}${attrText}>\n${bodyParts.join('\n\n')}\n</${tagName}>`
}

export const registerAgentMarkdownSerializer = (
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

export const registerAgentMarkdownSerializers = (
  entries: AgentMarkdownSerializerMap,
  options: AgentMarkdownSerializerRegistrationOptions = {}
) => {
  for (const [name, serializer] of Object.entries(entries)) {
    registerAgentMarkdownSerializer(name, serializer, options)
  }
}

export const defineAgentMarkdownComponent = (component: AgentMarkdownComponent) => component

export const registerAgentMarkdownComponent = (
  name: string,
  component: AgentMarkdownComponent,
  options: AgentMarkdownSerializerRegistrationOptions = {}
) => {
  registerAgentMarkdownSerializer(name, component.render, options)
}

export const registerAgentMarkdownComponents = (
  entries: AgentMarkdownComponentMap,
  options: AgentMarkdownSerializerRegistrationOptions = {}
) => {
  for (const [name, component] of Object.entries(entries)) {
    registerAgentMarkdownComponent(name, component, options)
  }
}

export const clearAgentMarkdownSerializers = () => {
  serializers.clear()
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

const collectionConfig = (collection: string) =>
  contentConfig().collections?.[collection]

const markdownEnabledCollectionEntries = (collections?: string[]) =>
  Object.entries(contentConfig().collections || {})
    .filter(([name, config]) => (!collections?.length || collections.includes(name)) && resolveAgentMarkdownOptions(config as any))

const isPublicPage = (page: ParsedContent, config: ContentCollectionConfig | undefined) =>
  Boolean(
    page
    && config
    && config.type !== 'data'
    && config.sitemap !== false
    && !page._draft
    && !page._partial
    && !page._navigation
    && (page as { navigation?: unknown }).navigation !== false
    && (page as { robots?: unknown }).robots !== 'noindex'
    && (page as { sitemap?: unknown }).sitemap !== false
  )

const escapeMarkdownText = (value: string) =>
  value.replace(/\*/g, '\\*').replace(/_/g, '\\_').replace(/\[/g, '\\[').replace(/\]/g, '\\]')

const textValue = (node: MarkdownNode): string => {
  if (node.type === 'text') return node.value || ''
  return (node.children || []).map(child => textValue(child)).join('')
}

const renderChildren = (node: MarkdownNode, ctx: AgentMarkdownContext) =>
  (node.children || []).map(child => renderNode(child, ctx)).join('').trim()

const block = (value: string) => value.trim() ? `${value.trim()}\n\n` : ''

const renderList = (node: MarkdownNode, ctx: AgentMarkdownContext, ordered = false) =>
  block((node.children || []).map((child, index) => {
    const body = renderChildren(child, ctx).replace(/\n+/g, '\n  ').trim()
    return `${ordered ? `${index + 1}.` : '-'} ${body}`
  }).join('\n'))

const renderTable = (node: MarkdownNode, ctx: AgentMarkdownContext) => {
  const rows = (node.children || []).flatMap(section => section.tag === 'thead' || section.tag === 'tbody'
    ? (section.children || [])
    : [section]
  ).filter(row => row.tag === 'tr')

  if (!rows.length) return ''

  const cells = rows.map(row => (row.children || [])
    .filter(cell => cell.tag === 'th' || cell.tag === 'td')
    .map(cell => renderChildren(cell, ctx).replace(/\|/g, '\\|').trim())
  )
  const width = Math.max(...cells.map(row => row.length))
  const normalized = cells.map(row => [...row, ...Array.from({ length: width - row.length }, () => '')])
  const [head = [], ...bodyRows] = normalized
  return block([
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...bodyRows.map(row => `| ${row.join(' | ')} |`)
  ].join('\n'))
}

const renderUnknownComponentOmission = (name: string, reason?: string) =>
  `> Component omitted: \`${name}\`.\n> ${reason || 'This page contains an interactive or site-specific block that has no agent markdown serializer yet.'}`

const renderUnknownComponent = (node: MarkdownNode, ctx: AgentMarkdownContext) => {
  const tag = node.tag || 'component'
  const props = cleanPropsObject(node.props)
  const children = renderChildren(node, ctx)

  if (children || Object.keys(props).length) {
    return block(xmlComponentMarkdown(tag, props, children))
  }

  return block(renderUnknownComponentOmission(tag))
}

const serializerForTag = (tag: string) => {
  const markdownTags = contentConfig().markdown?.tags || {}
  const candidates = new Set([
    tag,
    pascalCase(tag),
    kebabCase(tag),
    markdownTags[tag],
    markdownTags[pascalCase(tag)],
    markdownTags[kebabCase(tag)]
  ].filter((value): value is string => Boolean(value)))

  for (const candidate of candidates) {
    const serializer = serializers.get(candidate)
    if (serializer) return serializer
  }
}

const renderNode = (node: MarkdownNode, ctx: AgentMarkdownContext): string => {
  if (node.type === 'text') return node.value || ''

  const tag = node.tag || ''
  const serializer = tag ? serializerForTag(tag) : undefined
  if (serializer) {
    const nodeCtx: AgentMarkdownContext = {
      ...ctx,
      prop: name => getMarkdownProp(node, name),
      props: target => (isRecord((target || node).props) ? (target || node).props as Record<string, unknown> : {}),
      cleanProps: target => cleanPropsObject((target || node).props),
      children: target => renderChildren(target || node, nodeCtx)
    }
    const rendered = serializer(node, nodeCtx)
    if (typeof rendered === 'string') return block(rendered)
  }

  if (!tag) return renderChildren(node, ctx)

  if (/^h[1-6]$/.test(tag)) {
    const depth = Number(tag.slice(1))
    return block(`${'#'.repeat(Math.max(1, Math.min(6, depth)))} ${renderChildren(node, ctx)}`)
  }

  switch (tag) {
    case 'p':
      return block(renderChildren(node, ctx))
    case 'blockquote':
      return block(renderChildren(node, ctx).split('\n').map(line => `> ${line}`).join('\n'))
    case 'strong':
    case 'b':
      return `**${renderChildren(node, ctx)}**`
    case 'em':
    case 'i':
      return `_${renderChildren(node, ctx)}_`
    case 'span':
      return renderChildren(node, ctx)
    case 'code':
      return `\`${node.value || textValue(node)}\``
    case 'pre':
      return block(`\`\`\`\n${textValue(node)}\n\`\`\``)
    case 'a': {
      const href = typeof node.props?.href === 'string' ? node.props.href : ''
      const text = renderChildren(node, ctx) || href
      return href ? linkMarkdown(text, routeMarkdownPathForHref(href, ctx.locale, ctx.path)) : text
    }
    case 'ul':
      return renderList(node, ctx)
    case 'ol':
      return renderList(node, ctx, true)
    case 'li':
      return renderChildren(node, ctx)
    case 'hr':
      return '---\n\n'
    case 'br':
      return '\n'
    case 'img': {
      const src = typeof node.props?.src === 'string' ? node.props.src : ''
      const alt = typeof node.props?.alt === 'string' ? node.props.alt : ''
      return src ? imageMarkdown(alt, src) : escapeMarkdownLinkLabel(alt)
    }
    case 'table':
      return renderTable(node, ctx)
    case 'thead':
    case 'tbody':
    case 'tr':
    case 'th':
    case 'td':
      return renderChildren(node, ctx)
    default:
      return renderUnknownComponent(node, ctx)
  }
}

const renderMarkdownRoot = (
  body: MarkdownRoot | null | undefined,
  context: Omit<AgentMarkdownContext, 'renderChildren' | 'renderNode'>
) => {
  if (!body?.children?.length) return ''
  const ctx: AgentMarkdownContext = {
    ...context,
    prop: () => '',
    props: node => (node ? (isRecord(node.props) ? node.props : {}) : {}),
    cleanProps: node => cleanPropsObject(node?.props),
    children: node => node ? renderChildren(node, ctx) : '',
    renderChildren: node => renderChildren(node, ctx),
    renderNode: node => renderNode(node, ctx),
    blockquote: value => blockquoteMarkdown(value),
    jsonFence: value => jsonFenceMarkdown(value),
    link: (label, href) => linkMarkdown(label, href),
    omitted: (name, reason) => renderUnknownComponentOmission(name, reason),
    xmlComponent: (name, props, children) => xmlComponentMarkdown(name, props, children)
  }
  return body.children.map(node => renderNode(node, ctx)).join('').trim()
}

const hasH1 = (markdown: string) => /^#\s+/m.test(markdown)

const normalizeDescription = (page: ParsedContent) =>
  typeof page.description === 'string' && page.description.trim()
    ? page.description.trim()
    : ''

const renderAgentMarkdown = (
  page: ParsedContent,
  collection: string,
  path: string,
  locale: string | undefined,
  _options: ResolvedAgentMarkdownOptions
) => {
  const title = typeof page.title === 'string' && page.title.trim()
    ? page.title.trim()
    : path.split('/').filter(Boolean).pop() || 'Index'
  const description = normalizeDescription(page)
  const rendered = renderMarkdownRoot(page.body, { collection, page, path, locale } as any)
  const parts: string[] = []
  if (!hasH1(rendered)) parts.push(`# ${escapeMarkdownText(title)}`)
  if (description && !rendered.includes(description)) parts.push(`> ${description}`)
  if (rendered) parts.push(rendered)
  return parts.join('\n\n').trim() + '\n'
}

const toAgentMarkdown = (
  collection: string,
  page: ParsedContent,
  options: ResolvedAgentMarkdownOptions
): AgentMarkdown => {
  const path = normalizeAgentRoutePath((page as { path?: string }).path || page._requestedRoute || page._path)
  const locale = (page as { locale?: string }).locale || page._resolvedLocale || page._locale
  const title = typeof page.title === 'string' && page.title.trim()
    ? page.title.trim()
    : path.split('/').filter(Boolean).pop() || 'Index'
  const description = normalizeDescription(page)
  return {
    path,
    markdownPath: agentMarkdownPathForRoute(path),
    rawPath: agentRawPathForRoute(path),
    ...(locale ? { locale } : {}),
    collection,
    title,
    description,
    markdown: renderAgentMarkdown(page, collection, path, locale, options),
    ...(page._file ? { sourceFile: page._file } : {}),
    canonicalUrl: path,
    ...(typeof (page as { updated?: unknown }).updated === 'string' ? { lastModified: (page as unknown as { updated: string }).updated } : {}),
    metadataFields: options.metadata,
    includeInIndex: options.includeInIndex,
    includeInFull: options.includeInFull
  }
}

const collectionHandle = (name: string, config: ContentCollectionConfig): ContentCollectionHandle =>
  ({ ...config, name } as ContentCollectionHandle)

const routeBaseForLocale = (config: ContentCollectionConfig, locale?: string) => {
  if (!config.route) return ''
  if (typeof config.route === 'string') return normalizeAgentRoutePath(config.route)
  const localized = locale ? config.route[locale] : undefined
  return typeof localized === 'string' ? normalizeAgentRoutePath(localized) : ''
}

const collectionDefaultLocale = (config: ContentCollectionConfig) => {
  const collectionI18n = config.i18n && typeof config.i18n === 'object' ? config.i18n : undefined
  return collectionI18n?.defaultLocale || contentConfig().defaultLocale || contentConfig().agent?.site?.defaultLocale
}

const prefixRequestedLocale = (path: string, locale: string | undefined, defaultLocale: string | undefined) => {
  const normalized = normalizeAgentRoutePath(path)
  if (!locale || locale === defaultLocale) return normalized
  if (normalized === `/${locale}` || normalized.startsWith(`/${locale}/`)) return normalized
  if (normalized === '/') return `/${locale}`
  return `/${locale}${normalized}`
}

const publicPathForLocale = (
  collection: string,
  config: ContentCollectionConfig,
  rowPath: string,
  locale: string | undefined,
  defaultLocale: string | undefined
) => {
  const normalizedRowPath = normalizeAgentRoutePath(rowPath || '/')
  const base = routeBaseForLocale(config, locale)
  if (base && (normalizedRowPath === base || normalizedRowPath.startsWith(`${base}/`))) {
    return prefixRequestedLocale(normalizedRowPath, locale, defaultLocale)
  }

  return getCollectionPath(collectionHandle(collection, config), {
    ...(locale ? { locale } : {}),
    path: normalizedRowPath
  })
}

const publicPathForQueryRow = (
  collection: string,
  config: ContentCollectionConfig,
  row: ParsedContent,
  locale?: string
) => {
  const requested = (row as { path?: string }).path || row._requestedRoute
  if (requested) return normalizeAgentRoutePath(requested)

  const defaultLocale = collectionDefaultLocale(config)
  const rowPath = normalizeAgentRoutePath(row._path || '/')
  const resolvedLocale = row._resolvedLocale || row._locale
  if (locale && resolvedLocale && locale !== resolvedLocale) {
    const sourceLocalePath = publicPathForLocale(collection, config, rowPath, resolvedLocale, defaultLocale)
    return prefixRequestedLocale(sourceLocalePath, locale, defaultLocale)
  }

  return publicPathForLocale(collection, config, rowPath, locale, defaultLocale)
}

export async function resolveContentMarkdown (
  event: H3Event,
  collection: string,
  routeOrPath: string = '/',
  options: { locale?: string } = {}
): Promise<AgentMarkdown | null> {
  const config = collectionConfig(collection)
  const agentOptions = resolveAgentMarkdownOptions(config)
  if (!config || !agentOptions) return null
  const provider = await getContentProvider(event)
  if (!provider.page) return null
  const page = await provider.page<ParsedContent>(event, collection, routeOrPath, {
    ...(options.locale ? { locale: options.locale } : {})
  })
  if (!page || !isPublicPage(page, config)) return null
  return toAgentMarkdown(collection, page, agentOptions)
}

export async function resolveContentMarkdownByRoute (
  event: H3Event,
  routePath: string,
  options: { locale?: string, collections?: string[] } = {}
): Promise<AgentMarkdown | null> {
  for (const [collection] of markdownEnabledCollectionEntries(options.collections)) {
    const page = await resolveContentMarkdown(event, collection, routePath, {
      ...(options.locale ? { locale: options.locale } : {})
    })
    if (page) return page
  }
  return null
}

const normalizeQueryResult = <T>(value: ContentQueryResponse<T>): T[] =>
  Array.isArray(value.result) ? value.result : []

export async function queryMarkdownEnabledContent (
  event: H3Event,
  options: { locale?: string, collections?: string[], limit?: number } = {}
): Promise<AgentMarkdownMeta[]> {
  const provider = await getContentProvider(event)
  const result: AgentMarkdownMeta[] = []

  for (const [collection, config] of markdownEnabledCollectionEntries(options.collections)) {
    const agentOptions = resolveAgentMarkdownOptions(config as any)
    if (!agentOptions) continue
    const rows = normalizeQueryResult<ParsedContent>(await provider.query<ParsedContent>(event, {
      collection,
      only: ['path', 'locale', 'localePaths', '_path', '_locale', '_resolvedLocale', '_requestedRoute', '_file', '_draft', '_partial', '_navigation', 'title', 'description', 'updated', 'navigation', 'robots', 'sitemap'],
      ...(options.limit ? { limit: options.limit } : {}),
      ...(options.locale ? { resolveLocale: { locale: options.locale, fallback: true } } : {})
    }))
    for (const row of rows) {
      if (!isPublicPage(row, config as any)) continue
      const locale = options.locale || row._resolvedLocale || row._locale
      const path = publicPathForQueryRow(collection, config as any, row, locale)
      const title = typeof row.title === 'string' && row.title.trim()
        ? row.title.trim()
        : path.split('/').filter(Boolean).pop() || 'Index'
      const description = normalizeDescription(row)
      result.push({
        path,
        markdownPath: agentMarkdownPathForRoute(path),
        rawPath: agentRawPathForRoute(path),
        ...(locale ? { locale } : {}),
        collection,
        title,
        description,
        ...(row._file ? { sourceFile: row._file } : {}),
        canonicalUrl: path,
        ...(typeof (row as { updated?: unknown }).updated === 'string' ? { lastModified: (row as unknown as { updated: string }).updated } : {}),
        metadataFields: agentOptions.metadata,
        includeInIndex: agentOptions.includeInIndex,
        includeInFull: agentOptions.includeInFull
      })
    }
  }

  return result
}
