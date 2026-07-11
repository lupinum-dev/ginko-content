import type { H3Event } from 'h3'
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
import { pathHasLocalePrefix } from '../../core/content/path'
import { projectContentRoute } from '../../features/localization/route-projector'
import { isPublicationVisible, resolveRuntimeEnvironment, type ContentVisibilityContext } from '../../core/visibility'
import { isPreview } from '../../integrations/nitro/preview'
import { many, one } from './query-api'
import { contentConfig } from './storage-access'

const visibilityContextForEvent = (event: H3Event): ContentVisibilityContext => ({
  environment: resolveRuntimeEnvironment(),
  previewAuthorized: isPreview(event)
})

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

// Publication visibility (draft) is applied here through the one core
// predicate (`isPublicationVisible`, VNEXT.md 13.6/24.2) rather than a
// hardcoded `!page.draft` — a provider's raw query result can legitimately
// carry drafts as facts (providers never decide Ginko's own visibility
// policy), so agent output follows the same environment/preview-aware
// visibility as every other surface instead of always hiding drafts.
//
// What remains structural (never a route: data collections, partials,
// navigation-control files) plus agent output's own consumer-specific
// "public index" policy: it deliberately mirrors navigation/sitemap/robots
// opt-outs so agent-facing markdown/llms output doesn't advertise a page the
// site itself hid from indexing.
const isPublicPage = (page: ParsedContent, config: ContentCollectionConfig | undefined, visibility: ContentVisibilityContext) =>
  Boolean(
    page
    && config
    && config.type !== 'data'
    && config.sitemap !== false
    && isPublicationVisible({ draft: page.draft }, visibility)
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
  const route = (page as { route?: { resolvedPath?: string } }).route
  const resolution = (page as { resolution?: { resolved?: { locale?: string } } }).resolution
  const path = normalizeAgentRoutePath(route?.resolvedPath || (page as { path?: string }).path || page.resolved?.requestedRoute)
  const locale = resolution?.resolved?.locale || (page as { locale?: string }).locale || page.resolved?.locale || page.locale
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

/**
 * Empty-`routeMounts` policy pattern (VNEXT.md §12.2, matching
 * `features/query/routes.ts#getCollectionPath`): only a locale prefix is
 * needed here, so `projectContentRoute` gets a policy with an empty
 * `routeMounts` and owns the prefix decision instead of a hand-assembled one.
 */
const prefixRequestedLocale = (path: string, locale: string | undefined, defaultLocale: string | undefined) => {
  const normalized = normalizeAgentRoutePath(path)
  if (!locale) return normalized
  if (pathHasLocalePrefix(normalized, [locale])) return normalized
  return projectContentRoute(
    { contentPath: normalized, locale },
    { localized: true, locales: [locale], defaultLocale, fallback: {}, translatedSlugs: false, routeMounts: {} }
  )
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
  const route = (row as { route?: { resolvedPath?: string } }).route
  if (route?.resolvedPath) return normalizeAgentRoutePath(route.resolvedPath)

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
  const page = await one(event, collection, {
    by: { route: routeOrPath },
    ...(options.locale ? { locale: options.locale } : {}),
    fallback: true
  }) as unknown as ParsedContent | null
  if (!page || !isPublicPage(page, config, visibilityContextForEvent(event))) return null
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

export async function queryMarkdownEnabledContent (
  event: H3Event,
  options: { locale?: string, collections?: string[], limit?: number } = {}
): Promise<AgentMarkdownMeta[]> {
  const result: AgentMarkdownMeta[] = []
  const visibility = visibilityContextForEvent(event)

  for (const [collection, config] of markdownEnabledCollectionEntries(options.collections)) {
    const agentOptions = resolveAgentMarkdownOptions(config as any)
    if (!agentOptions) continue
    const rows = await many(event, collection, {
      select: [
        'file', 'draft', 'partial', 'navigationFile', 'title', 'description',
        'updated', 'navigation', 'robots', 'sitemap'
      ],
      ...(options.limit ? { limit: options.limit } : {}),
      ...(options.locale ? { locale: options.locale, fallback: true } : {})
    }) as unknown as ParsedContent[]
    for (const row of rows) {
      if (!isPublicPage(row, config as any, visibility)) continue
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
