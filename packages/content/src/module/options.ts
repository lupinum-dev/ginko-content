import type { Nuxt } from '@nuxt/schema'
import { hasNuxtModule } from '@nuxt/kit'
import type { ContentSearchEngine, ContentSearchPublicRuntimeConfig } from '../types/search'
import type { ContentSearchOptions, ModuleOptions, ResolvedContentI18nOptions } from '../types/module'
import { resolveLocalePolicy } from '../features/localization/locale-policy'
import type { LocalePolicyCollectionInput, ResolvedLocalePolicy } from '../features/localization/locale-policy'
import { normalizeContentSitemapAssertOptions } from './sitemap-assert'
import { GINKO_SITEMAP_SOURCE_NAME, resolveContentSitemapSource } from '../runtime/utils/sitemap-source'
import { compileWhere } from '../core/query/filter'
import { normalizeMiniSearchOptions } from '../features/search/options'

type NuxtI18nConfig = {
  defaultLocale?: string
  locales?: Array<string | { code?: string, language?: string }>
  strategy?: string
}

export function hasNuxtI18nModule(nuxt: Nuxt): boolean {
  return hasNuxtModule('@nuxtjs/i18n', nuxt)
}

export function hasNuxtSitemapModule(nuxt: Nuxt): boolean {
  return hasNuxtModule('@nuxtjs/sitemap', nuxt)
}

export function configureNuxtSitemapSource(
  nuxt: Nuxt,
  apiBaseURL: string,
  sitemapPath = '/sitemap'
) {
  if (!hasNuxtSitemapModule(nuxt)) {
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
}

export function resolveNuxtSitemapPrerenderRoutes(nuxt: Nuxt): string[] {
  if (!hasNuxtSitemapModule(nuxt)) {
    return []
  }

  const nuxtSitemap = (nuxt.options as { sitemap?: { sitemaps?: unknown } }).sitemap
  if (nuxtSitemap?.sitemaps === false) {
    return ['/sitemap.xml']
  }

  const nuxtI18n = (nuxt.options as { i18n?: NuxtI18nConfig }).i18n || {}
  if (!hasNuxtI18nModule(nuxt) || !Array.isArray(nuxtI18n.locales) || nuxtI18n.locales.length === 0) {
    return ['/sitemap.xml']
  }

  const childRoutes = nuxtI18n.locales
    .map(locale => typeof locale === 'string' ? locale : (locale.language || locale.code))
    .filter(Boolean)
    .map(locale => `/__sitemap__/${locale}.xml`)

  return Array.from(new Set(['/sitemap.xml', '/sitemap_index.xml', ...childRoutes]))
}

/**
 * Resolve the immutable, site-wide locale policy for the whole content
 * context. This is the sole place authority between
 * Nuxt I18n and Ginko content config is decided:
 *
 * - when `@nuxtjs/i18n` is installed, it is the sole authority for
 *   `locales`/`defaultLocale` — declaring `content.i18n.locales` or
 *   `content.i18n.defaultLocale` fails setup rather than unioning values;
 * - fallback and translated-slug policy always belong to Ginko content.
 */
export function resolveContentLocalePolicy(
  options: Pick<ModuleOptions, 'i18n'>,
  nuxt: Nuxt,
  collections: readonly LocalePolicyCollectionInput[] = []
): ResolvedLocalePolicy {
  const moduleI18n = options.i18n === false ? undefined : (options.i18n === true ? {} : (options.i18n || {}))
  const nuxtI18n = (nuxt.options as { i18n?: NuxtI18nConfig }).i18n || {}
  const nuxtLocales = Array.isArray(nuxtI18n.locales)
    ? nuxtI18n.locales.map(locale => typeof locale === 'string' ? locale : locale.code).filter((code): code is string => Boolean(code))
    : undefined

  return resolveLocalePolicy({
    nuxtI18n: {
      installed: hasNuxtI18nModule(nuxt),
      locales: nuxtLocales,
      defaultLocale: nuxtI18n.defaultLocale,
      strategy: nuxtI18n.strategy
    },
    content: {
      locales: moduleI18n?.locales,
      defaultLocale: moduleI18n?.defaultLocale,
      fallback: moduleI18n?.fallback,
      translatedSlugs: moduleI18n?.translatedSlugs ?? false
    },
    collections: [...collections]
  })
}

/**
 * Adapt a resolved locale policy back into the flat shape most existing
 * consumers (runtime config, nitro config, static output, route-meta
 * validation) accept. `strictTranslatedSlugs` is not part of the locale
 * policy — it is a validation-strictness toggle read straight off module
 * options.
 */
export function toResolvedContentI18nOptions(
  policy: ResolvedLocalePolicy,
  options: Pick<ModuleOptions, 'i18n'>
): ResolvedContentI18nOptions {
  const moduleI18n = options.i18n === false || options.i18n === true ? undefined : options.i18n
  return {
    locales: [...policy.locales],
    defaultLocale: policy.defaultLocale,
    fallback: Object.fromEntries(Object.entries(policy.fallback).map(([locale, chain]) => [locale, [...chain]])),
    translatedSlugs: policy.translatedSlugs,
    strictTranslatedSlugs: moduleI18n?.strictTranslatedSlugs ?? false
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

  const engine = (options.search as { engine?: unknown } | undefined)?.engine
  if (engine !== undefined && engine !== 'minisearch' && engine !== 'pagefind' && engine !== 'provider') {
    throw new Error(`Unsupported content.search.engine: ${String(engine)}. Expected "minisearch", "pagefind", or "provider".`)
  }
  const normalizedEngine: ContentSearchEngine = engine === 'pagefind' || engine === 'provider'
    ? engine
    : 'minisearch'
  const filterQuery = compileWhere(
    options.search?.filterQuery === undefined
      ? { partial: false }
      : options.search.filterQuery
  )

  return {
    engine: normalizedEngine,
    ignoredTags: options.search?.ignoredTags || ['script', 'style', 'pre'],
    filterQuery,
    collections: options.search?.collections,
    extraFields: options.search?.extraFields || [],
    apiBaseURL: options.search?.apiBaseURL,
    minisearch: normalizeMiniSearchOptions(options.search?.minisearch)
  }
}

/**
 * When the pagefind search engine is selected, verify its optional peer package is
 * installed at module-setup time and fail with one actionable line if it is not.
 * `pagefind` is an optional peerDependency (only prod-search deployments that pick the
 * pagefind engine need it), so a missing import must surface as an install instruction
 * rather than an opaque runtime "Cannot find module" during static generation.
 */
export async function assertPagefindAvailable (
  search: ReturnType<typeof normalizeSearchOptions>,
  importPagefind: () => Promise<unknown> = () => import('pagefind')
): Promise<void> {
  if (search === false || search.engine !== 'pagefind') {
    return
  }
  try {
    await importPagefind()
  } catch {
    throw new Error('Content search engine "pagefind" is enabled but the optional "pagefind" package is not installed. Install it: pnpm add -D pagefind')
  }
}

export function createSearchRuntimeConfig(
  search: Pick<ContentSearchOptions, 'apiBaseURL' | 'engine' | 'minisearch'>,
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
