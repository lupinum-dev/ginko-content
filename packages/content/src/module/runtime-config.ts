import { defu } from 'defu'
import type { Nuxt } from '@nuxt/schema'

import type { ModuleOptions, ResolvedContentContext } from '../types/module'
import type {
  ContentAgentAppPageContext,
  ContentAgentConfig,
  ContentAgentLocalizedValue,
  ContentAgentRuntimeConfig,
  ContentCollectionConfig,
  ContentConfig
} from '../types/config'
import type { ResolvedMarkdownPlugin } from '../types/content'
import type { ContentSearchPublicRuntimeConfig } from '../types/search'
import type { ResolvedCollectionLocalePolicy } from '../features/localization/locale-policy'
import { CACHE_VERSION } from '../utils'
import { normalizeMiniSearchOptions } from './options'

const resolveNuxtSiteUrl = (nuxt: Nuxt) => {
  const publicRuntime = nuxt.options.runtimeConfig.public as Record<string, any>
  const publicContentRuntime = publicRuntime.content as Record<string, any> | undefined
  const configuredSiteUrl = publicContentRuntime?.siteUrl || publicRuntime.siteUrl
  if (typeof configuredSiteUrl === 'string' && configuredSiteUrl.length > 0) {
    return configuredSiteUrl
  }

  const nuxtSite = (nuxt.options as { site?: { url?: unknown } }).site
  return typeof nuxtSite?.url === 'string' && nuxtSite.url.length > 0
    ? nuxtSite.url
    : undefined
}

type RuntimeCollectionConfig = {
  source?: ContentCollectionConfig['source']
  exclude?: ContentCollectionConfig['exclude']
  type?: ContentCollectionConfig['type']
  strict: boolean
  i18n?: false | { defaultLocale: string, locales: string[] }
  localePolicy: ResolvedCollectionLocalePolicy
  sitemap?: boolean
  route?: ContentCollectionConfig['route']
  translatedSlugs?: boolean
  cms?: ContentCollectionConfig['cms']
  agent?: ContentCollectionConfig['agent']
  references?: Record<string, string[]>
  /** Top-level schema membership derived at build time for server diagnostics. */
  schemaFields?: string[]
}

const sanitizePublicMarkdownPluginValue = (value: unknown): unknown => {
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }

  if (Array.isArray(value)) {
    return value
      .map(item => sanitizePublicMarkdownPluginValue(item))
      .filter(item => item !== undefined)
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return value
  }

  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'transformers')
    .map(([key, item]) => [key, sanitizePublicMarkdownPluginValue(item)])
    .filter(([, item]) => item !== undefined))
}

export const sanitizePublicMarkdownPlugins = (plugins: ResolvedMarkdownPlugin[]) =>
  plugins.map(plugin => ({
    name: plugin.name,
    options: sanitizePublicMarkdownPluginValue(plugin.options || {}) as Record<string, unknown>
  }))

const sanitizePrivateMarkdownPluginValue = (value: unknown): unknown => {
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined
  }

  if (Array.isArray(value)) {
    return value
      .map(item => sanitizePrivateMarkdownPluginValue(item))
      .filter(item => item !== undefined)
  }

  if (typeof value !== 'object' || value === null) {
    return value
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return value
  }

  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => [key, sanitizePrivateMarkdownPluginValue(item)])
    .filter(([, item]) => item !== undefined))
}

export const sanitizePrivateMarkdownPlugins = (plugins: ResolvedMarkdownPlugin[]) =>
  plugins.map(plugin => ({
    name: plugin.name,
    options: sanitizePrivateMarkdownPluginValue(plugin.options || {}) as Record<string, unknown>
  }))

const localizedValue = (
  value: ContentAgentLocalizedValue | undefined,
  locale: string,
  fallback = ''
) => {
  if (typeof value === 'string') return value
  if (!value) return fallback
  return value[locale] || Object.values(value)[0] || fallback
}

const resolveAgentAppPageValue = async (
  value: ContentAgentLocalizedValue | ((ctx: ContentAgentAppPageContext) => string | Promise<string>),
  ctx: ContentAgentAppPageContext
) => {
  if (typeof value === 'function') {
    return await value(ctx)
  }
  return localizedValue(value, ctx.locale)
}

const sanitizeAgentConfig = async (
  agent: ContentAgentConfig | undefined,
  contentContext: ResolvedContentContext,
  siteUrl: string | undefined
): Promise<ContentAgentRuntimeConfig | undefined> => {
  if (!agent) {
    return undefined
  }

  const defaultLocale = contentContext.localePolicy.defaultLocale
  const locales = contentContext.locales?.length ? contentContext.locales : [defaultLocale]
  const agentSiteUrl = siteUrl || agent.site?.url || 'http://localhost:3000'
  const pages = await Promise.all((agent.pages || []).map(async (page) => {
    const title: Record<string, string> = {}
    const description: Record<string, string> = {}
    const markdown: Record<string, string> = {}

    for (const locale of locales) {
      const ctx = { locale, defaultLocale, siteUrl: agentSiteUrl }
      title[locale] = await resolveAgentAppPageValue(page.title, ctx)
      description[locale] = await resolveAgentAppPageValue(page.description, ctx)
      markdown[locale] = await page.render(ctx)
    }

    return {
      id: page.id,
      route: page.route,
      section: page.section,
      title,
      description,
      updated: page.updated,
      includeInIndex: page.includeInIndex,
      includeInFull: page.includeInFull,
      metadata: page.metadata,
      markdown
    }
  }))

  return {
    ...(agent.site ? { site: agent.site } : {}),
    ...(agent.markdown ? { markdown: agent.markdown } : {}),
    ...(agent.sections ? { sections: agent.sections } : {}),
    ...(pages.length ? { pages } : {})
  } satisfies ContentAgentRuntimeConfig
}

export const applyContentRuntimeConfig = async (
  nuxt: Nuxt,
  options: ModuleOptions,
  contentContext: ResolvedContentContext,
  appContentConfig: Pick<ContentConfig, 'agent'>,
  runtimeCollections: Record<string, RuntimeCollectionConfig>,
  privateRuntimeCollections: Record<string, RuntimeCollectionConfig>,
  buildIntegrity: number | undefined,
  cacheIntegrity: string
) => {
  const revalidate = options.revalidate === false ? undefined : options.revalidate
  const defaultLocale = contentContext.localePolicy.defaultLocale
  const searchRuntime = contentContext.search === false
    ? false
    : {
        apiBaseURL: contentContext.search.apiBaseURL || `${options.api.baseURL.replace(/\/$/, '')}/search`,
        indexURL: `${(contentContext.search.apiBaseURL || `${options.api.baseURL.replace(/\/$/, '')}/search`).replace(/\/$/, '')}/index.json`,
        engine: contentContext.search.engine || 'minisearch',
        minisearch: normalizeMiniSearchOptions(contentContext.search.minisearch)
      } satisfies ContentSearchPublicRuntimeConfig
  const siteUrl = resolveNuxtSiteUrl(nuxt)
  const contentRuntime = defu(nuxt.options.runtimeConfig.public.content, {
    ...(siteUrl ? { siteUrl } : {}),
    locales: contentContext.locales,
    provider: contentContext.provider || 'filesystem',
    providers: contentContext.providers || {},
    defaultLocale,
    localeFallback: contentContext.localeFallback || {},
    translatedSlugs: contentContext.translatedSlugs ?? false,
    strictTranslatedSlugs: contentContext.strictTranslatedSlugs ?? false,
    collections: runtimeCollections,
    renderPolicies: Object.fromEntries(
      Object.entries(contentContext.contract.collections).map(([id, collection]) => [
        id,
        collection.componentPolicy,
      ]),
    ),
    links: contentContext.links || {},
    integrity: buildIntegrity as number,
    respectPathCase: options.respectPathCase ?? false,
    api: {
      baseURL: options.api.baseURL
    },
    markdown: {
      plugins: sanitizePublicMarkdownPlugins(contentContext.markdown.plugins),
      tags: contentContext.markdown.tags,
      anchorLinks: contentContext.markdown.anchorLinks,
      image: contentContext.markdown.image || 'auto'
    },
    sitemap: contentContext.sitemap
      ? {
          path: contentContext.sitemap.path || '/sitemap',
          ...(contentContext.sitemap.include?.length ? { include: contentContext.sitemap.include } : {}),
          ...(contentContext.sitemap.exclude?.length ? { exclude: contentContext.sitemap.exclude } : {}),
          ...(typeof contentContext.sitemap.includeDrafts === 'boolean' ? { includeDrafts: contentContext.sitemap.includeDrafts } : {})
        }
      : false,
    search: searchRuntime,
    navigation: contentContext.navigation as any
  })

  const runtimeAgent = await sanitizeAgentConfig(appContentConfig.agent, contentContext, siteUrl)
  const privateContentRuntime = {
    ...contentContext as any,
    ...(runtimeAgent ? { agent: runtimeAgent } : {}),
    markdown: {
      ...contentContext.markdown,
      plugins: sanitizePrivateMarkdownPlugins(contentContext.markdown.plugins)
    }
  }

  // @ts-expect-error - runtime config typing is augmented in this module package.
  nuxt.options.runtimeConfig.public.content = contentRuntime
  nuxt.options.runtimeConfig.content = defu(nuxt.options.runtimeConfig.content as any, {
    cacheVersion: CACHE_VERSION,
    cacheIntegrity,
    revalidate: revalidate?.token
      ? {
          token: revalidate.token,
          allowUnsigned: revalidate.allowUnsigned === true
        }
      : false,
    ...privateContentRuntime,
    collections: privateRuntimeCollections
  })
}
