import { defu } from 'defu'
import type { Nuxt } from '@nuxt/schema'
import type { ContentMiniSearchOptions, ContentSearchPublicRuntimeConfig } from '../types/search'
import type { ModuleOptions, ResolvedContentI18nOptions } from '../types/module'
import { normalizeContentSitemapAssertOptions } from './sitemap-assert'
import { GINKO_SITEMAP_SOURCE_NAME, resolveContentSitemapSource } from '../runtime/utils/sitemap-source'

type NuxtI18nConfig = {
  defaultLocale?: string
  locales?: Array<string | { code?: string, language?: string }>
}

function hasNuxtModule(modules: unknown[] = [], name: string): boolean {
  return modules.some((entry) => {
    if (typeof entry === 'string') {
      return entry === name
    }

    if (Array.isArray(entry) && typeof entry[0] === 'string') {
      return entry[0] === name
    }

    return false
  })
}

export function hasNuxtI18nModule(modules: unknown[] = []): boolean {
  return hasNuxtModule(modules, '@nuxtjs/i18n')
}

export function hasNuxtSitemapModule(modules: unknown[] = []): boolean {
  return hasNuxtModule(modules, '@nuxtjs/sitemap')
}

export function configureNuxtSitemapSource(
  nuxt: Nuxt,
  apiBaseURL: string,
  sitemapPath = '/sitemap'
) {
  if (!hasNuxtSitemapModule(nuxt.options.modules)) {
    return
  }

  const source = {
    context: {
      name: GINKO_SITEMAP_SOURCE_NAME
    },
    fetch: resolveContentSitemapSource(apiBaseURL, sitemapPath)
  }
  const sitemap = ((nuxt.options as { sitemap?: Record<string, any> }).sitemap ??= {})
  const sources = Array.isArray(sitemap.sources) ? sitemap.sources : []
  sitemap.sources = [
    ...sources.filter((item) => {
      if (typeof item === 'string') return item !== source.fetch
      return item?.fetch !== source.fetch && item?.context?.name !== GINKO_SITEMAP_SOURCE_NAME
    }),
    source
  ]
  sitemap.excludeAppSources = true
}

export function resolveNuxtSitemapPrerenderRoutes(nuxt: Nuxt): string[] {
  if (!hasNuxtSitemapModule(nuxt.options.modules)) {
    return []
  }

  const nuxtSitemap = (nuxt.options as { sitemap?: { sitemaps?: unknown } }).sitemap
  if (nuxtSitemap?.sitemaps === false) {
    return ['/sitemap.xml']
  }

  const nuxtI18n = (nuxt.options as { i18n?: NuxtI18nConfig }).i18n || {}
  if (!hasNuxtI18nModule(nuxt.options.modules) || !Array.isArray(nuxtI18n.locales) || nuxtI18n.locales.length === 0) {
    return ['/sitemap.xml']
  }

  const childRoutes = nuxtI18n.locales
    .map(locale => typeof locale === 'string' ? locale : (locale.language || locale.code))
    .filter(Boolean)
    .map(locale => `/__sitemap__/${locale}.xml`)

  return Array.from(new Set(['/sitemap.xml', '/sitemap_index.xml', ...childRoutes]))
}

export function resolveModuleI18nOptions(
  options: Pick<ModuleOptions, 'i18n'>,
  nuxt: Nuxt
): ResolvedContentI18nOptions {
  if (options.i18n === false) {
    return {
      locales: [],
      defaultLocale: undefined,
      fallback: {},
      translatedSlugs: false,
      strictTranslatedSlugs: false
    }
  }

  const moduleI18n = options.i18n === true ? {} : (options.i18n || {})
  const nuxtI18n = (nuxt.options as { i18n?: NuxtI18nConfig }).i18n || {}
  const nuxtLocales = Array.isArray(nuxtI18n.locales)
    ? nuxtI18n.locales.map(locale => typeof locale === 'string' ? locale : locale.code).filter(Boolean)
    : []

  const locales = Array.from(new Set([
    moduleI18n.defaultLocale,
    nuxtI18n.defaultLocale,
    ...(moduleI18n.locales || []),
    ...nuxtLocales
  ].filter(Boolean))) as string[]

  const defaultLocale = moduleI18n.defaultLocale
    || nuxtI18n.defaultLocale
    || locales[0]

  return {
    locales,
    defaultLocale,
    fallback: defu({}, moduleI18n.fallback),
    translatedSlugs: moduleI18n.translatedSlugs ?? false,
    strictTranslatedSlugs: moduleI18n.strictTranslatedSlugs ?? false
  }
}

export function normalizeSitemapOptions(options: Pick<ModuleOptions, 'sitemap'>) {
  if (options.sitemap === false) {
    return false as const
  }

  const sitemap = options.sitemap === true ? {} : options.sitemap
  return {
    path: sitemap.path || '/sitemap',
    include: sitemap.include,
    exclude: sitemap.exclude || [],
    includeDrafts: sitemap.includeDrafts,
    assert: normalizeContentSitemapAssertOptions(sitemap.assert)
  }
}

export function normalizeSearchOptions(options: Pick<ModuleOptions, 'search'>) {
  if (options.search === false) {
    return false as const
  }

  return {
    engine: options.search?.engine || 'minisearch',
    ignoredTags: options.search?.ignoredTags || ['script', 'style', 'pre'],
    filterQuery: options.search?.filterQuery || { _draft: false, _partial: false },
    collections: options.search?.collections,
    extraFields: options.search?.extraFields || [],
    apiBaseURL: options.search?.apiBaseURL,
    minisearch: normalizeMiniSearchOptions(options.search?.minisearch)
  }
}

export const defaultMiniSearchOptions = {
  fields: ['title', 'content', 'headings'],
  storeFields: ['path', 'title', 'excerpt', 'anchor', 'locale', 'collection'],
  boost: {
    title: 4,
    headings: 2,
    content: 1
  },
  fuzzy: 0.2,
  prefix: true
} as const
const requiredMiniSearchStoreFields = ['path', 'title', 'excerpt'] as const

export function normalizeMiniSearchOptions (options: Partial<ContentMiniSearchOptions> = {}) {
  const fields = options?.fields?.filter((field): field is string => typeof field === 'string' && field.length > 0)
  const storeFields = options?.storeFields?.filter((field): field is string => typeof field === 'string' && field.length > 0)
  const boost = Object.fromEntries(
    Object.entries(options?.boost || {})
      .filter((entry): entry is [string, number] => typeof entry[0] === 'string' && entry[0].length > 0 && typeof entry[1] === 'number' && Number.isFinite(entry[1]))
  )

  const resolvedFields = fields?.length ? fields : [...defaultMiniSearchOptions.fields]
  const resolvedStoreFields = storeFields?.length ? storeFields : defaultMiniSearchOptions.storeFields

  return {
    fields: resolvedFields,
    storeFields: Array.from(new Set([...requiredMiniSearchStoreFields, ...resolvedStoreFields])),
    boost: Object.keys(boost).length ? boost : { ...defaultMiniSearchOptions.boost },
    fuzzy: typeof options?.fuzzy === 'boolean' || typeof options?.fuzzy === 'number' ? options.fuzzy : defaultMiniSearchOptions.fuzzy,
    prefix: typeof options?.prefix === 'boolean' ? options.prefix : defaultMiniSearchOptions.prefix
  }
}

export function createSearchRuntimeConfig(
  search: Exclude<ModuleOptions['search'], false>,
  apiBaseURL: string
): ContentSearchPublicRuntimeConfig {
  const resolvedApiBaseURL = search.apiBaseURL || `${apiBaseURL.replace(/\/$/, '')}/search`
  return {
    apiBaseURL: resolvedApiBaseURL,
    indexURL: `${resolvedApiBaseURL.replace(/\/$/, '')}/index.json`,
    engine: search.engine || 'minisearch',
    minisearch: normalizeMiniSearchOptions(search.minisearch)
  }
}
