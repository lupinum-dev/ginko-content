import type { H3Event } from 'h3'
import type { ContentQueryResponse } from '../../types/api'
import type { MarkdownRoot, ParsedContent } from '../../types/content'
import type { ContentCollectionConfig, ContentCollectionHandle } from '../../types/config'
import type {
  AgentMarkdown,
  AgentMarkdownComponent,
  AgentMarkdownComponentMap,
  AgentMarkdownMeta,
  AgentMarkdownRegistry,
  AgentMarkdownRenderContext,
  AgentMarkdownSerializer,
  AgentMarkdownSerializerMap,
  AgentMarkdownSerializerRegistrationOptions,
  ResolvedAgentMarkdownOptions
} from '../../features/agent/agent-markdown'
import {
  createAgentMarkdownRegistry,
  resolveAgentMarkdownOptions
} from '../../features/agent/agent-markdown'
import { renderAgentMarkdownBody } from '../../features/agent/walker'
import { agentMarkdownPathForRoute, agentRawPathForRoute, normalizeAgentRoutePath } from '../../features/agent/agent-paths'
import { getCollectionPath } from '../../features/query/routes'
import { getContentProvider } from './providers'
import { createProviderQuery } from './provider-query'
import { contentConfig } from './storage-access'

export * from '../../features/agent/agent-markdown'
export { renderAgentMarkdownBody } from '../../features/agent/walker'

// --- Per-process serializer singleton --------------------------------------
//
// `appRegistry` is a per-process singleton: one instance shared by every
// request in this server process. Serializers are registered into it via
// `registerAgentMarkdownSerializer` (and friends) from Nitro plugins during
// server startup. Re-registering the same name throws unless `{ override: true }`
// is passed, in which case the last registration wins. The walker reads the
// current registry through the context. `createAgentMarkdownRegistry` remains
// the primitive for creating isolated registries (e.g. tests) that do not touch
// this shared singleton.

const appRegistry: AgentMarkdownRegistry = createAgentMarkdownRegistry()

/** The current app's serializer registry the walker resolves tags against. */
export const getAgentMarkdownRegistry = (): AgentMarkdownRegistry => appRegistry

export const registerAgentMarkdownSerializer = (
  name: string,
  serializer: AgentMarkdownSerializer,
  options?: AgentMarkdownSerializerRegistrationOptions
) => appRegistry.register(name, serializer, options)

export const registerAgentMarkdownSerializers = (
  entries: AgentMarkdownSerializerMap,
  options?: AgentMarkdownSerializerRegistrationOptions
) => appRegistry.registerMany(entries, options)

export const registerAgentMarkdownComponent = (
  name: string,
  component: AgentMarkdownComponent,
  options?: AgentMarkdownSerializerRegistrationOptions
) => appRegistry.registerComponent(name, component, options)

export const registerAgentMarkdownComponents = (
  entries: AgentMarkdownComponentMap,
  options?: AgentMarkdownSerializerRegistrationOptions
) => appRegistry.registerComponents(entries, options)

export const clearAgentMarkdownSerializers = () => appRegistry.clear()

// --- Config-derived context inputs -----------------------------------------

const defaultLocale = () => contentConfig().defaultLocale || contentConfig().locales?.[0] || contentConfig().agent?.site?.defaultLocale || 'en'

const configuredLocales = (): string[] => {
  const locales = contentConfig().agent?.site?.locales?.length
    ? contentConfig().agent?.site?.locales
    : contentConfig().locales
  return locales?.length ? locales : [defaultLocale()]
}

const buildRenderContext = (
  collection: string,
  page: ParsedContent,
  path: string,
  locale: string | undefined
): AgentMarkdownRenderContext => ({
  collection,
  page,
  path,
  locale,
  registry: appRegistry,
  tagAliases: contentConfig().markdown?.tags || {},
  defaultLocale: defaultLocale(),
  locales: configuredLocales()
})

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
    && !page.draft
    && !page.partial
    && !page.navigationFile
    && (page as { navigation?: unknown }).navigation !== false
    && (page as { robots?: unknown }).robots !== 'noindex'
    && (page as { sitemap?: unknown }).sitemap !== false
  )

const escapeMarkdownText = (value: string) =>
  value.replace(/\*/g, '\\*').replace(/_/g, '\\_').replace(/\[/g, '\\[').replace(/\]/g, '\\]')

// --- Document assembly (thin handlers over the pure walker) -----------------

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
  const rendered = renderAgentMarkdownBody(page.body as MarkdownRoot | null | undefined, buildRenderContext(collection, page, path, locale))
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
  const path = normalizeAgentRoutePath((page as { path?: string }).path || page.resolved?.requestedRoute)
  const locale = (page as { locale?: string }).locale || page.resolved?.locale || page.locale
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
    ...(page.file?.path ? { sourceFile: page.file?.path } : {}),
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
  const requested = (row as { path?: string }).path || row.resolved?.requestedRoute
  if (requested) return normalizeAgentRoutePath(requested)

  const defaultLocale = collectionDefaultLocale(config)
  const rowPath = normalizeAgentRoutePath(row.path || '/')
  const resolvedLocale = row.resolved?.locale || row.locale
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
    const rows = normalizeQueryResult<ParsedContent>(await provider.query<ParsedContent>(event, createProviderQuery({
      collection,
      only: ['path', 'locale', 'localePaths', 'resolved', 'file', 'draft', 'partial', 'navigationFile', 'title', 'description', 'updated', 'navigation', 'robots', 'sitemap'],
      ...(options.limit ? { limit: options.limit } : {}),
      ...(options.locale ? { resolveLocale: { locale: options.locale, fallback: true } } : {})
    })))
    for (const row of rows) {
      if (!isPublicPage(row, config as any)) continue
      const locale = options.locale || row.resolved?.locale || row.locale
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
        ...(row.file?.path ? { sourceFile: row.file?.path } : {}),
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
