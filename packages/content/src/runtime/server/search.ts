import type { H3Event } from 'h3'
import type { ParsedContent } from '../../types/content'
import type { ContentProviderQueryInput, ContentProviderQueryWhere } from '../../types/query'
import { useRuntimeConfig } from 'nitropack/runtime'
import { createSearchSections } from '../../features/search/sections'
import { toSearchIndexRecord } from '../../features/search/records'
import { resolveCollectionI18n } from '../../features/localization/path'
import { unwrapListResponse } from '../../features/query/responses'
import { createServerContentQueryContext } from './query-api'

type SearchablePage = Pick<ParsedContent, 'path' | 'locale' | 'title' | 'description' | 'body'> & Record<string, unknown>

type SearchSectionWithLocale = ReturnType<typeof createSearchSections>[number] & { locale?: string, collection?: string }
const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)))
type RuntimeSearchConfig = {
  search?: {
    collections?: string[]
  } | false
  collections?: Record<string, {
    type?: 'page' | 'data'
    route?: unknown
    sitemap?: boolean
  } | unknown>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const hasRouteMount = (route: unknown) =>
  route !== undefined && route !== null && route !== ''

const isRouteBackedSearchCollection = (config: unknown) => {
  if (!isRecord(config) || config.sitemap === false || config.type === 'data') {
    return false
  }

  return config.type === 'page' || hasRouteMount(config.route) || config.sitemap === true
}

export const resolveSearchCollections = (
  runtimeContent: RuntimeSearchConfig,
  collectionsOverride?: string[]
) => {
  const configuredCollections = collectionsOverride || (runtimeContent.search
    ? runtimeContent.search.collections
    : undefined)

  if (configuredCollections?.length) {
    return unique(configuredCollections)
  }

  return Object.entries(runtimeContent.collections || {})
    .filter(([, config]) => isRouteBackedSearchCollection(config))
    .map(([collection]) => collection)
}

const mergeSearchFilter = (
  filterQuery?: ContentProviderQueryWhere,
  locale?: string
): ContentProviderQueryWhere | undefined => {
  const localeFilter: ContentProviderQueryWhere | undefined = locale ? { locale: locale } : undefined

  if (filterQuery && localeFilter) {
    return { $and: [filterQuery, localeFilter] }
  }

  return filterQuery || localeFilter
}

async function loadSearchDocuments (
  event: H3Event,
  filterQuery?: ContentProviderQueryWhere,
  locale?: string,
  collectionsOverride?: string[],
  opts: {
    allLocales?: boolean
    extraFields?: string[]
  } = {}
): Promise<SearchablePage[]> {
  const runtimeConfig = useRuntimeConfig(event)
  const collections = resolveSearchCollections(runtimeConfig.content, collectionsOverride)
  const context = await createServerContentQueryContext(event)

  const results = await Promise.all(collections.map(async (collection) => {
    const loadPages = async (queryLocale?: string) => {
      const mergedFilter = mergeSearchFilter(filterQuery, queryLocale)
      const params: ContentProviderQueryInput = {
        collection,
        only: ['path', 'locale', 'title', 'description', 'body', ...(opts.extraFields || [])],
        ...(mergedFilter ? { where: [mergedFilter] } : {})
      }
      const pages = unwrapListResponse<Record<string, unknown>>(await context.transport('query', params))
      return pages.map(page => ({
        ...page,
        path: typeof page.path === 'string'
          ? page.path
          : (page.route as { resolvedPath?: string } | undefined)?.resolvedPath || ''
      }))
    }

    if (locale) {
      return await loadPages(locale)
    }

    const collectionI18n = opts.allLocales
      ? resolveCollectionI18n(collection, runtimeConfig.content)
      : undefined

    if (opts.allLocales && collectionI18n?.locales.length) {
      const localizedResults = await Promise.all(collectionI18n.locales.map(async collectionLocale => await loadPages(collectionLocale)))
      return localizedResults.flat()
    }

    return await loadPages()
  }))

  return results.flat() as SearchablePage[]
}

export async function buildSearchIndex (
  event: H3Event,
  opts: {
    collections?: string[]
    ignoredTags?: string[]
    extraFields?: string[]
    filterQuery?: ContentProviderQueryWhere
    locale?: string
    allLocales?: boolean
  } = {}
) {
  const runtimeConfig = useRuntimeConfig(event)
  const extraFields = opts.extraFields || runtimeConfig.content.search?.extraFields || []
  const pages = await loadSearchDocuments(event, opts.filterQuery, opts.locale, opts.collections, {
    allLocales: opts.allLocales,
    extraFields
  })
  const sections = createSearchSections(pages, {
    ignoredTags: opts.ignoredTags || [],
    extraFields: unique(['locale', 'collection', ...extraFields])
  }) as SearchSectionWithLocale[]
  return sections.map(toSearchIndexRecord)
}
