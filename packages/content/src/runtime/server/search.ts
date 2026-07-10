import type { H3Event } from 'h3'
import type { ParsedContent } from '../../types/content'
import type { ContentQueryBuilderWhere } from '../../types/query'
import { useRuntimeConfig } from 'nitropack/runtime'
import type { ContentSearchIndexRecord } from '../../types/search'
import { createSearchSections } from '../../features/search/sections'
import { resolveCollectionI18n } from '../../features/localization/path'
import { getContentProvider } from './providers'
import { serverQueryCollection } from './provider-query'

export { searchRecords } from '../shared/search'

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

const searchRecordsCache = new Map<string, ContentSearchIndexRecord[]>()
const MAX_SEARCH_RECORDS_CACHE_ENTRIES = 12

export const clearSearchRecordsCache = () => {
  searchRecordsCache.clear()
}

const rememberSearchRecords = (cacheKey: string, records: ContentSearchIndexRecord[]) => {
  if (searchRecordsCache.has(cacheKey)) {
    searchRecordsCache.delete(cacheKey)
  }
  searchRecordsCache.set(cacheKey, records)
  while (searchRecordsCache.size > MAX_SEARCH_RECORDS_CACHE_ENTRIES) {
    const oldest = searchRecordsCache.keys().next().value
    if (typeof oldest !== 'string') {
      break
    }
    searchRecordsCache.delete(oldest)
  }
}

const mergeSearchFilter = (
  filterQuery?: ContentQueryBuilderWhere,
  locale?: string
): ContentQueryBuilderWhere | undefined => {
  const localeFilter: ContentQueryBuilderWhere | undefined = locale ? { locale: locale } : undefined

  if (filterQuery && localeFilter) {
    return { $and: [filterQuery, localeFilter] }
  }

  return filterQuery || localeFilter
}

export async function serverSearchContent (
  event: H3Event,
  filterQuery?: ContentQueryBuilderWhere,
  locale?: string,
  collectionsOverride?: string[],
  opts: {
    allLocales?: boolean
    extraFields?: string[]
  } = {}
): Promise<SearchablePage[]> {
  const runtimeConfig = useRuntimeConfig(event)
  const collections = resolveSearchCollections(runtimeConfig.content, collectionsOverride)

  const results = await Promise.all(collections.map(async (collection) => {
    const loadPages = async (queryLocale?: string) => {
      const query = serverQueryCollection(event, collection)
        .select('path', 'locale', 'title', 'description', 'body', ...(opts.extraFields || []))
      const mergedFilter = mergeSearchFilter(filterQuery, queryLocale)

      const pages = mergedFilter
        ? await (query as any).where(mergedFilter).find()
        : await (query as any).find()
      return (pages as Array<Record<string, unknown>>).map(page => ({
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

const toSearchRecord = (section: SearchSectionWithLocale): ContentSearchIndexRecord => {
  const [path = '', anchor = ''] = section.id.split('#')
  const extraFields = Object.fromEntries(
    Object.entries(section).filter(([key]) => !['id', 'title', 'titles', 'content', 'level'].includes(key))
  )

  return {
    ...extraFields,
    id: section.id,
    collection: section.collection || '',
    path,
    title: section.title,
    excerpt: section.content.slice(0, 240),
    content: section.content,
    headings: section.titles,
    anchor: anchor || undefined,
    locale: typeof section.locale === 'string' ? section.locale : undefined
  }
}

export async function buildSearchIndex (
  event: H3Event,
  opts: {
    collections?: string[]
    ignoredTags?: string[]
    extraFields?: string[]
    filterQuery?: ContentQueryBuilderWhere
    locale?: string
    allLocales?: boolean
  } = {}
) {
  const runtimeConfig = useRuntimeConfig(event)
  const provider = await getContentProvider(event)
  const cacheKey = JSON.stringify({
    provider: provider.name,
    integrity: runtimeConfig.content.cacheIntegrity || runtimeConfig.public.content?.integrity,
    collections: resolveSearchCollections(runtimeConfig.content, opts.collections),
    ignoredTags: opts.ignoredTags || [],
    extraFields: opts.extraFields || runtimeConfig.content.search?.extraFields || [],
    filterQuery: opts.filterQuery,
    locale: opts.locale,
    allLocales: opts.allLocales
  })
  const cached = searchRecordsCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const extraFields = opts.extraFields || runtimeConfig.content.search?.extraFields || []
  const pages = await serverSearchContent(event, opts.filterQuery, opts.locale, opts.collections, {
    allLocales: opts.allLocales,
    extraFields
  })
  const sections = createSearchSections(pages, {
    ignoredTags: opts.ignoredTags || [],
    extraFields: unique(['locale', 'collection', ...extraFields])
  }) as SearchSectionWithLocale[]
  const records = sections.map(toSearchRecord)

  rememberSearchRecords(cacheKey, records)
  return records
}
