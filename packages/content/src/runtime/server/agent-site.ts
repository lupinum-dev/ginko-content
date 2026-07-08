import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'
import type { AgentMarkdown, AgentMarkdownMeta } from './agent-markdown'
import { linkMarkdown, queryMarkdownEnabledContent, resolveContentMarkdownByRoute } from './agent-markdown'
import { agentMarkdownPathForRoute, agentRawPathForRoute, agentRoutePathFromIndexSlug, agentRoutePathFromRawSlug, normalizeAgentRoutePath } from '../../features/agent/agent-paths'
import { contentConfig } from './storage-access'
import type {
  AgentMetadataField,
  ContentAgentAppPageConfig,
  ContentAgentAppPageContext,
  ContentAgentLocalizedValue,
  ContentAgentRuntimeAppPageConfig
} from '../../types/config'

export type AgentPageSource = 'ginko' | 'app-owned'

export interface AgentPage {
  title: string
  description: string
  path: string
  markdownPath: string
  rawPath: string
  url: string
  markdownUrl: string
  section: string
  sectionTitle: string
  sectionOrder: number
  locale: string
  source: AgentPageSource
  collection?: string
  updated?: string
  metadataFields?: readonly AgentMetadataField[]
  includeInIndex: boolean
  includeInFull: boolean
  markdown?: string
}

type AgentMetadataValue = string | string[]

const localizedValue = (
  value: ContentAgentLocalizedValue | undefined,
  locale: string,
  fallback = ''
) => {
  if (typeof value === 'string') return value
  if (!value) return fallback
  return value[locale] || value[defaultLocale()] || Object.values(value)[0] || fallback
}

const defaultLocale = () => contentConfig().agent?.site?.defaultLocale || contentConfig().defaultLocale || contentConfig().locales?.[0] || 'en'

export const getAgentLocales = () => {
  const site = contentConfig().agent?.site
  const locales = site?.locales?.length ? site.locales : contentConfig().locales
  return locales?.length ? locales : [defaultLocale()]
}

export const isSupportedAgentLocale = (locale: string | undefined) =>
  Boolean(locale && getAgentLocales().includes(locale))

const resolveSiteUrl = (event?: H3Event) => {
  const configured = contentConfig().agent?.site?.url
  if (configured) return configured
  if (event && !import.meta.prerender) {
    const url = getRequestURL(event)
    return `${url.protocol}//${url.host}`
  }
  return 'http://localhost:3000'
}

const joinUrl = (base: string, path: string) => new URL(normalizeAgentRoutePath(path), base).toString()

const prefixLocale = (path: string, locale: string) => {
  const normalized = normalizeAgentRoutePath(path)
  if (locale === defaultLocale()) return normalized
  if (normalized === `/${locale}` || normalized.startsWith(`/${locale}/`)) return normalized
  if (normalized === '/') return `/${locale}`
  return `/${locale}${normalized}`
}

const sectionConfig = (id: string | undefined) => {
  const sections = contentConfig().agent?.sections || []
  return sections.find((section: { id?: string }) => section.id === id)
}

const resolveSection = (id: string | undefined, locale: string) => {
  const resolvedId = id || 'content'
  const section = sectionConfig(resolvedId)
  return {
    id: resolvedId,
    title: localizedValue(section?.title, locale, resolvedId === 'content' ? 'Content' : resolvedId),
    order: section?.order ?? 1000
  }
}

const collectionSectionId = (collection: string) =>
  contentConfig().collections?.[collection]?.agent?.section || 'content'

const resolveLocalizedMaybeFunction = async (
  value: ContentAgentAppPageConfig['title'] | ContentAgentAppPageConfig['description'],
  ctx: ContentAgentAppPageContext
) => {
  if (typeof value === 'function') return await value(ctx)
  return localizedValue(value, ctx.locale)
}

const resolveAppPageMarkdown = async (
  page: ContentAgentRuntimeAppPageConfig,
  ctx: ContentAgentAppPageContext
) => {
  if (typeof page.render === 'function') {
    return await page.render(ctx)
  }
  return localizedValue(page.markdown, ctx.locale)
}

const resolveAppPageRoute = (page: ContentAgentRuntimeAppPageConfig, locale: string) =>
  normalizeAgentRoutePath(localizedValue(page.route, locale, '/'))

const createAppPageContext = (locale: string, siteUrl: string): ContentAgentAppPageContext => ({
  locale,
  defaultLocale: defaultLocale(),
  siteUrl
})

const metadataPolicy = () => {
  const metadata = contentConfig().agent?.markdown?.metadata
  if (metadata === false) return { enabled: false, defaultFields: [] as string[] }
  if (Array.isArray(metadata)) return { enabled: true, defaultFields: metadata }
  return {
    enabled: metadata?.enabled !== false,
    defaultFields: Array.isArray(metadata?.defaultFields) ? metadata.defaultFields : [] as string[]
  }
}

const createGinkoAgentPage = (
  meta: AgentMarkdownMeta,
  locale: string,
  siteUrl: string
): AgentPage => {
  const path = prefixLocale(meta.path, locale)
  const rawPath = agentRawPathForRoute(path)
  const section = resolveSection(collectionSectionId(meta.collection), locale)

  return {
    title: meta.title,
    description: meta.description,
    path,
    markdownPath: agentMarkdownPathForRoute(path),
    rawPath,
    url: joinUrl(siteUrl, path),
    markdownUrl: joinUrl(siteUrl, rawPath),
    section: section.id,
    sectionTitle: section.title,
    sectionOrder: section.order,
    locale,
    source: 'ginko',
    collection: meta.collection,
    updated: meta.lastModified,
    metadataFields: meta.metadataFields as any,
    includeInIndex: meta.includeInIndex,
    includeInFull: meta.includeInFull
  }
}

const createAppOwnedAgentPages = async (locale: string, siteUrl: string) => {
  const pages = (contentConfig().agent?.pages || []) as ContentAgentRuntimeAppPageConfig[]
  const result: AgentPage[] = []

  for (const page of pages) {
    const ctx = createAppPageContext(locale, siteUrl)
    const path = resolveAppPageRoute(page, locale)
    const rawPath = agentRawPathForRoute(path)
    const section = resolveSection(page.section, locale)
    const markdown = await resolveAppPageMarkdown(page, ctx)

    result.push({
      title: await resolveLocalizedMaybeFunction(page.title, ctx),
      description: await resolveLocalizedMaybeFunction(page.description, ctx),
      path,
      markdownPath: agentMarkdownPathForRoute(path),
      rawPath,
      url: joinUrl(siteUrl, path),
      markdownUrl: joinUrl(siteUrl, rawPath),
      section: section.id,
      sectionTitle: section.title,
      sectionOrder: section.order,
      locale,
      source: 'app-owned',
      updated: page.updated,
      metadataFields: page.metadata,
      includeInIndex: page.includeInIndex !== false,
      includeInFull: page.includeInFull !== false,
      markdown
    })
  }

  return result
}

const sortPages = (pages: AgentPage[]) =>
  pages.sort((a, b) => {
    const sectionDelta = a.sectionOrder - b.sectionOrder
    if (sectionDelta) return sectionDelta
    return a.path.localeCompare(b.path)
  })

const assertUniqueAgentPages = (pages: AgentPage[]) => {
  const seen = new Map<string, AgentPage>()
  for (const page of pages) {
    for (const [kind, value] of [
      ['route', page.path],
      ['raw route', page.rawPath],
      ['markdown route', page.markdownPath]
    ] as const) {
      const key = `${kind}:${value}`
      const existing = seen.get(key)
      if (existing) {
        throw new Error(
          `Duplicate agent ${kind} "${value}" for "${existing.title}" (${existing.source}) and "${page.title}" (${page.source}). ` +
          'Every agent-facing page must have one canonical route.'
        )
      }
      seen.set(key, page)
    }
  }
}

export const buildAgentPageIndex = async (event: H3Event, locale = defaultLocale()) => {
  const siteUrl = resolveSiteUrl(event)
  const content = await queryMarkdownEnabledContent(event, { locale })
  const pages = [
    ...await createAppOwnedAgentPages(locale, siteUrl),
    ...content.map(meta => createGinkoAgentPage(meta, locale, siteUrl))
  ]

  assertUniqueAgentPages(pages)
  return sortPages(pages)
}

const sourceLabel = (source: AgentPageSource) =>
  source === 'ginko' ? 'ginko-content' : 'app-owned'

const metadataForPage = (page: AgentPage): Partial<Record<string, AgentMetadataValue>> => ({
  title: page.title,
  description: page.description,
  url: page.url,
  route: page.path,
  locale: page.locale,
  section: page.sectionTitle,
  collection: page.collection,
  source: sourceLabel(page.source),
  updated: page.updated
})

const quoteYamlString = (value: string) => JSON.stringify(value)

const renderYamlValue = (value: AgentMetadataValue) => {
  if (Array.isArray(value)) {
    if (!value.length) return '[]'
    return value.map(entry => `\n  - ${quoteYamlString(entry)}`).join('')
  }

  return quoteYamlString(value)
}

export const renderAgentMarkdownFrontmatter = (page: AgentPage) => {
  const policy = metadataPolicy()
  if (!policy.enabled) return ''

  const fields = page.metadataFields?.length ? page.metadataFields : policy.defaultFields
  const metadata = metadataForPage(page)
  const lines = fields.flatMap((field: keyof ReturnType<typeof metadataForPage>) => {
    const value = metadata[field]
    return value ? [`${field}: ${renderYamlValue(value)}`] : []
  })

  return lines.length ? `---\n${lines.join('\n')}\n---\n\n` : ''
}

export const renderAgentMarkdownPage = (page: AgentPage, markdown: string) =>
  `${renderAgentMarkdownFrontmatter(page)}${markdown.trim()}\n`

export const renderLlmsTxt = (pages: AgentPage[], locale = defaultLocale()) => {
  const site = contentConfig().agent?.site
  const visible = pages.filter(page => page.includeInIndex)
  const sections = new Map<string, { title: string, order: number, pages: AgentPage[] }>()

  for (const page of visible) {
    const entry = sections.get(page.section) || { title: page.sectionTitle, order: page.sectionOrder, pages: [] }
    entry.pages.push(page)
    sections.set(page.section, entry)
  }

  const lines = [
    `# ${localizedValue(site?.title, locale, 'Site')}`,
    '',
    `> ${localizedValue(site?.description, locale, '')}`
  ]

  if (site?.profile) lines.push('', `Profile: ${site.profile}`)
  if (site?.contentSignals) {
    lines.push(
      `AI input: ${site.contentSignals.aiInput ? 'yes' : 'no'}`,
      `AI training: ${site.contentSignals.aiTrain ? 'yes' : 'no'}`
    )
  }

  for (const section of Array.from(sections.values()).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))) {
    lines.push('', `## ${section.title}`, '')
    for (const page of section.pages) {
      lines.push(`- ${linkMarkdown(page.title, page.markdownUrl)}: ${page.description.replace(/\n+/g, ' ')}`)
    }
  }

  return `${lines.join('\n').trim()}\n`
}

export const resolveMarkdownForPublicRoute = async (
  event: H3Event,
  routePath: string,
  locale = localeFromAgentPath(routePath)
): Promise<AgentMarkdown | { markdown: string } | null> => {
  const siteUrl = resolveSiteUrl(event)
  const normalized = normalizeAgentRoutePath(routePath)
  const appPage = (await createAppOwnedAgentPages(locale, siteUrl)).find(page => page.path === normalized)
  if (appPage?.markdown) {
    return { markdown: renderAgentMarkdownPage(appPage, appPage.markdown) }
  }

  const ginkoPage = await resolveContentMarkdownByRoute(event, normalized, { locale })
  if (!ginkoPage) return null

  return {
    ...ginkoPage,
    markdown: renderAgentMarkdownPage(createGinkoAgentPage(ginkoPage, locale, siteUrl), ginkoPage.markdown)
  }
}

export const renderLlmsFullTxt = async (event: H3Event, locale = defaultLocale()) => {
  const pages = await buildAgentPageIndex(event, locale)
  const lines = [renderLlmsTxt(pages, locale).trim()]

  for (const page of pages.filter(page => page.includeInFull)) {
    const markdown = page.markdown
      ? renderAgentMarkdownPage(page, page.markdown)
      : (await resolveMarkdownForPublicRoute(event, page.path, locale))?.markdown
    if (!markdown) continue
    lines.push('', '---', '', `Source: ${page.url}`, '', markdown.trim())
  }

  return `${lines.join('\n').trim()}\n`
}

export const localeFromAgentPath = (path: string) => {
  const normalized = normalizeAgentRoutePath(path)
  const fallback = defaultLocale()
  for (const locale of getAgentLocales()) {
    if (locale !== fallback && (normalized === `/${locale}` || normalized.startsWith(`/${locale}/`))) {
      return locale
    }
  }
  return fallback
}

export const routePathFromRawSlug = agentRoutePathFromRawSlug

export const routePathFromIndexSlug = agentRoutePathFromIndexSlug

export const collectAgentMarkdownPrerenderRoutes = async (event: H3Event) => {
  const routes = new Set<string>()
  for (const locale of getAgentLocales()) {
    const pages = await buildAgentPageIndex(event, locale)
    for (const page of pages) {
      routes.add(page.rawPath)
    }
    const prefix = locale === defaultLocale() ? '' : `/${locale}`
    routes.add(prefix ? `${prefix}/llms.txt` : '/llms.txt')
    routes.add(prefix ? `${prefix}/llms-full.txt` : '/llms-full.txt')
  }
  return Array.from(routes)
}
