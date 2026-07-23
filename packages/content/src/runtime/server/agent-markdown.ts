import type { H3Event } from 'h3'
import type { MarkdownRoot, ParsedContent, StrictParsedContentMeta } from '../../types/content'
import type { ContentCollectionConfig, ContentCollectionHandle } from '../../types/config'
import type { LocalizedDoc } from '../../types/query'
import type {
  AgentMarkdown,
  AgentMarkdownMeta,
  AgentMarkdownRenderContext,
  ResolvedAgentMarkdownOptions
} from '../../features/agent/agent-markdown'
import { resolveAgentMarkdownOptions } from '../../features/agent/agent-markdown'
import { renderAgentMarkdownBody } from '../../features/agent/walker'
import { agentMarkdownPathForRoute, agentRawPathForRoute, normalizeAgentRoutePath } from '../../features/agent/agent-paths'
import { getCollectionPath } from '../../features/query/routes'
import { pathHasLocalePrefix, prefixPathWithLocale } from '../../core/content/path'
import { isPublicationVisible, resolveRuntimeEnvironment, type ContentVisibilityContext } from '../../core/visibility'
import { isPreview } from '../../integrations/nitro/preview'
import { many, one } from './query-api'
import { contentConfig } from './storage-access'
import { getAgentMarkdownRegistry } from './agent-registry'

const visibilityContextForEvent = (event: H3Event): ContentVisibilityContext => ({
  environment: resolveRuntimeEnvironment(),
  previewAuthorized: isPreview(event)
})

export * from '../../features/agent/agent-markdown'
export * from './agent-registry'
export { renderAgentMarkdownBody } from '../../features/agent/walker'

// --- Config-derived context inputs -----------------------------------------

const defaultLocale = () => contentConfig().defaultLocale || contentConfig().locales?.[0] || 'en'

const configuredLocales = (): string[] => {
  const locales = contentConfig().locales
  return locales?.length ? locales : [defaultLocale()]
}

type AgentSourceDocument = Pick<
  LocalizedDoc<StrictParsedContentMeta>,
  'id' | 'locale' | 'route' | 'resolution' | 'file' | 'resolvedRefs'
> & {
  body?: MarkdownRoot | null
  title?: string
  description?: string
  draft?: boolean
  partial?: boolean
  navigationFile?: boolean
  navigation?: unknown
  robots?: unknown
  sitemap?: unknown
  updated?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * The unified query API promises one canonical localized-document envelope.
 * Agent output validates that public boundary once instead of probing removed
 * top-level `path`/`resolved` compatibility shapes throughout the renderer.
 */
const requireAgentSourceDocument = (value: unknown): AgentSourceDocument => {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.locale !== 'string' ||
    !isRecord(value.route) ||
    typeof value.route.resolvedPath !== 'string' ||
    !isRecord(value.resolution) ||
    !isRecord(value.resolution.resolved) ||
    typeof value.resolution.resolved.locale !== 'string' ||
    (value.title !== undefined && typeof value.title !== 'string') ||
    (value.description !== undefined && typeof value.description !== 'string') ||
    (value.updated !== undefined && typeof value.updated !== 'string') ||
    (value.draft !== undefined && typeof value.draft !== 'boolean') ||
    (value.partial !== undefined && typeof value.partial !== 'boolean') ||
    (value.navigationFile !== undefined && typeof value.navigationFile !== 'boolean')
  ) {
    throw new Error(
      'Agent markdown requires the canonical localized document envelope (`route.resolvedPath` and `resolution.resolved.locale`).'
    )
  }

  return value as AgentSourceDocument
}

const parsedContentForAgent = (page: AgentSourceDocument): ParsedContent => ({
  ...page,
  body: page.body ?? null
})

const asCollectionConfig = (value: unknown): ContentCollectionConfig | undefined =>
  isRecord(value) ? value : undefined

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
  registry: getAgentMarkdownRegistry(),
  tagAliases: contentConfig().markdown?.tags || {},
  defaultLocale: defaultLocale(),
  locales: configuredLocales()
})

const collectionConfig = (collection: string) =>
  asCollectionConfig(contentConfig().collections?.[collection])

const markdownEnabledCollectionEntries = (collections?: string[]) =>
  Object.entries(contentConfig().collections || {}).flatMap(([name, value]) => {
    const config = asCollectionConfig(value)
    return config &&
      (!collections?.length || collections.includes(name)) &&
      resolveAgentMarkdownOptions(config)
      ? [[name, config] as const]
      : []
  })

// Publication visibility (draft) is applied here through the one core
// predicate (`isPublicationVisible`) rather than a
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

const normalizeDescription = (page: { description?: string }) =>
  typeof page.description === 'string' && page.description.trim() ? page.description.trim() : ''

const renderAgentMarkdown = (
  page: AgentSourceDocument,
  collection: string,
  path: string,
  locale: string | undefined,
  _options: ResolvedAgentMarkdownOptions
) => {
  const title = typeof page.title === 'string' && page.title.trim()
    ? page.title.trim()
    : path.split('/').filter(Boolean).pop() || 'Index'
  const description = normalizeDescription(page)
  const rendered = renderAgentMarkdownBody(
    page.body,
    buildRenderContext(collection, parsedContentForAgent(page), path, locale)
  )
  const parts: string[] = []
  if (!hasH1(rendered)) parts.push(`# ${escapeMarkdownText(title)}`)
  if (description && !rendered.includes(description)) parts.push(`> ${description}`)
  if (rendered) parts.push(rendered)
  return parts.join('\n\n').trim() + '\n'
}

const toAgentMarkdown = (
  collection: string,
  page: AgentSourceDocument,
  options: ResolvedAgentMarkdownOptions
): AgentMarkdown => {
  const path = normalizeAgentRoutePath(page.route.resolvedPath)
  const locale = page.resolution.resolved.locale
  const title =
    typeof page.title === 'string' && page.title.trim()
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
    ...(page.updated ? { lastModified: page.updated } : {}),
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
  return collectionI18n?.defaultLocale || contentConfig().defaultLocale
}

const prefixRequestedLocale = (path: string, locale: string | undefined, defaultLocale: string | undefined) => {
  const normalized = normalizeAgentRoutePath(path)
  if (!locale) return normalized
  if (pathHasLocalePrefix(normalized, [locale])) return normalized
  return prefixPathWithLocale(normalized, locale, defaultLocale)
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
  row: AgentSourceDocument,
  locale?: string
) => {
  const resolvedPath = normalizeAgentRoutePath(row.route.resolvedPath)
  const resolvedLocale = row.resolution.resolved.locale
  if (!locale || locale === resolvedLocale) return resolvedPath

  const defaultLocale = collectionDefaultLocale(config)
  if (locale && resolvedLocale && locale !== resolvedLocale) {
    const sourceLocalePath = publicPathForLocale(
      collection,
      config,
      resolvedPath,
      resolvedLocale,
      defaultLocale
    )
    return prefixRequestedLocale(sourceLocalePath, locale, defaultLocale)
  }
  return publicPathForLocale(collection, config, resolvedPath, locale, defaultLocale)
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
  const result = await one(event, collection, {
    by: { route: routeOrPath },
    ...(options.locale ? { locale: options.locale } : {}),
    fallback: true
  })
  const page = result ? requireAgentSourceDocument(result) : null
  if (!page || !isPublicPage(parsedContentForAgent(page), config, visibilityContextForEvent(event)))
    return null
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
    const agentOptions = resolveAgentMarkdownOptions(config)
    if (!agentOptions) continue
    const rows = await many(event, collection, {
      select: [
        'file', 'draft', 'partial', 'navigationFile', 'title', 'description',
        'updated', 'navigation', 'robots', 'sitemap'
      ],
      ...(options.limit ? { limit: options.limit } : {}),
      ...(options.locale ? { locale: options.locale, fallback: true } : {})
    })
    for (const queryRow of rows) {
      const row = requireAgentSourceDocument(queryRow)
      if (!isPublicPage(parsedContentForAgent(row), config, visibility)) continue
      const locale = options.locale || row.resolution.resolved.locale
      const path = publicPathForQueryRow(collection, config, row, locale)
      const title =
        typeof row.title === 'string' && row.title.trim()
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
        ...(row.updated ? { lastModified: row.updated } : {}),
        metadataFields: agentOptions.metadata,
        includeInIndex: agentOptions.includeInIndex,
        includeInFull: agentOptions.includeInFull
      })
    }
  }

  return result
}
