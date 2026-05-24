import type { H3Event } from 'h3'
import type { ParsedContent } from '../../types/content'
import type { ContentQueryBuilderWhere } from '../../types/query'
import { useRuntimeConfig } from 'nitropack/runtime'
import type { ContentSearchIndexRecord } from '../../types/search'
import type { createSearchSections } from '../../features/search/sections'
import { resolveCollectionI18n } from '../../features/localization/path'
import { getContentProvider } from './providers'
import { serverQueryCollection } from './provider-query'
import { createContentProviderError } from '../../public/provider-errors'

export { searchRecords } from '../shared/search'

type SearchablePage = Pick<ParsedContent, '_path' | '_locale' | 'title' | 'description' | 'body'> & Record<string, unknown>

type SearchSectionWithLocale = ReturnType<typeof createSearchSections>[number] & { _locale?: string }
const unique = (values: string[]) => Array.from(new Set(values.filter(Boolean)))

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
  const localeFilter: ContentQueryBuilderWhere | undefined = locale ? { _locale: locale } : undefined

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
  } = {}
): Promise<SearchablePage[]> {
  const runtimeConfig = useRuntimeConfig(event)
  const configuredCollections = collectionsOverride || runtimeConfig.content.search?.collections
  const contentCollections = Object.keys(runtimeConfig.content.collections || {})
  const collections = (configuredCollections?.length ? configuredCollections : contentCollections)
    .filter(Boolean)

  const results = await Promise.all(collections.map(async (collection) => {
    const loadPages = async (queryLocale?: string) => {
      const query = serverQueryCollection(event, collection)
        .select('_path', '_locale', 'title', 'description', 'body')
      const mergedFilter = mergeSearchFilter(filterQuery, queryLocale)

      if (mergedFilter) {
        return await query.where(mergedFilter).find()
      }

      return await query.find()
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
    path,
    title: section.title,
    excerpt: section.content.slice(0, 240),
    content: section.content,
    headings: section.titles,
    anchor: anchor || undefined,
    locale: typeof section._locale === 'string' ? section._locale : undefined
  }
}

const buildProviderSearchSections = async (
  event: H3Event,
  collections: string[],
  provider: Awaited<ReturnType<typeof getContentProvider>> & { searchSections: NonNullable<Awaited<ReturnType<typeof getContentProvider>>['searchSections']> },
  opts: {
    ignoredTags?: string[]
    extraFields?: string[]
    filterQuery?: ContentQueryBuilderWhere
    locale?: string
    allLocales?: boolean
  }
): Promise<SearchSectionWithLocale[]> => {
  const runtimeConfig = useRuntimeConfig(event)
  const sections = await Promise.all(collections.map(async (collection) => {
    const loadCollectionLocale = async (locale?: string) => await provider.searchSections(event, collection, {
      ignoredTags: opts.ignoredTags || [],
      extraFields: unique(['_locale', ...(opts.extraFields || [])]),
      filterQuery: opts.filterQuery,
      locale
    }) as SearchSectionWithLocale[]

    if (opts.locale) {
      return await loadCollectionLocale(opts.locale)
    }

    const collectionI18n = opts.allLocales
      ? resolveCollectionI18n(collection, runtimeConfig.content)
      : undefined

    if (opts.allLocales && collectionI18n?.locales.length) {
      const localizedSections = await Promise.all(collectionI18n.locales.map(locale => loadCollectionLocale(locale)))
      return localizedSections.flat()
    }

    return await loadCollectionLocale()
  }))

  return sections.flat()
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
    collections: opts.collections || runtimeConfig.content.search?.collections,
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

  const collections = (opts.collections || runtimeConfig.content.search?.collections || Object.keys(runtimeConfig.content.collections || {}))
    .filter(Boolean)
  if (!provider.capabilities.searchSections) {
    throw createContentProviderError('unsupported_provider_search_index', `${provider.name} does not support search index generation`, {
      provider: provider.name
    })
  }
  if (!provider.searchSections) {
    throw createContentProviderError('unsupported_provider_search_index', `${provider.name} does not support search section generation`, {
      provider: provider.name
    })
  }
  const records = (await buildProviderSearchSections(event, collections, provider, {
    ignoredTags: opts.ignoredTags,
    extraFields: opts.extraFields || runtimeConfig.content.search?.extraFields || [],
    filterQuery: opts.filterQuery,
    locale: opts.locale,
    allLocales: opts.allLocales
  })).map(toSearchRecord)

  rememberSearchRecords(cacheKey, records)
  return records
}
