import MiniSearch from 'minisearch'
import type { SearchResult as MiniSearchResult } from 'minisearch'
import type { ContentMiniSearchOptions, ContentSearchIndexRecord, ContentSearchResult } from '../../types/search'

const DEFAULT_SEARCH_OPTIONS: ContentMiniSearchOptions = {
  fields: ['title', 'content', 'headings'],
  storeFields: ['path', 'title', 'excerpt', 'anchor', 'locale'],
  boost: {
    title: 4,
    headings: 2,
    content: 1
  },
  fuzzy: 0.2,
  prefix: true
}
const REQUIRED_STORE_FIELDS = ['path', 'title', 'excerpt'] as const
const MAX_SEARCH_INDEX_CACHE_ENTRIES = 12
const searchIndexCache = new Map<string, MiniSearch<ContentSearchIndexRecord>>()

const resolveSearchOptions = (options: Partial<ContentMiniSearchOptions> = {}): ContentMiniSearchOptions => {
  const fields = options.fields?.length ? options.fields : DEFAULT_SEARCH_OPTIONS.fields
  const storeFields = options.storeFields?.length ? options.storeFields : DEFAULT_SEARCH_OPTIONS.storeFields

  return {
    fields,
    storeFields: Array.from(new Set([...REQUIRED_STORE_FIELDS, ...storeFields])),
    boost: options.boost && Object.keys(options.boost).length ? options.boost : DEFAULT_SEARCH_OPTIONS.boost,
    fuzzy: typeof options.fuzzy === 'boolean' || typeof options.fuzzy === 'number' ? options.fuzzy : DEFAULT_SEARCH_OPTIONS.fuzzy,
    prefix: typeof options.prefix === 'boolean' ? options.prefix : DEFAULT_SEARCH_OPTIONS.prefix
  }
}

const rememberSearchIndex = (cacheKey: string, index: MiniSearch<ContentSearchIndexRecord>) => {
  if (searchIndexCache.has(cacheKey)) {
    searchIndexCache.delete(cacheKey)
  }
  searchIndexCache.set(cacheKey, index)
  while (searchIndexCache.size > MAX_SEARCH_INDEX_CACHE_ENTRIES) {
    const oldest = searchIndexCache.keys().next().value
    if (typeof oldest !== 'string') {
      break
    }
    searchIndexCache.delete(oldest)
  }
}

const createSearchIndex = (options: ContentMiniSearchOptions) => {
  return new MiniSearch<ContentSearchIndexRecord>({
    fields: options.fields,
    storeFields: options.storeFields,
    searchOptions: {
      prefix: options.prefix,
      fuzzy: options.fuzzy,
      boost: options.boost
    }
  })
}

const createCacheKey = (records: ContentSearchIndexRecord[], locale: string | undefined, options: ContentMiniSearchOptions) => {
  return JSON.stringify({
    locale: locale || '',
    records: records.map(record => Object.fromEntries(['id', ...options.fields, ...options.storeFields].map(field => [field, record[field]]))),
    fields: options.fields,
    storeFields: options.storeFields,
    boost: options.boost,
    fuzzy: options.fuzzy,
    prefix: options.prefix
  })
}

export const searchRecords = (
  records: ContentSearchIndexRecord[],
  term: string,
  locale?: string,
  searchOptions?: Partial<ContentMiniSearchOptions>
): ContentSearchResult[] => {
  if (!term.trim()) {
    return []
  }

  const options = resolveSearchOptions(searchOptions)
  const scopedRecords = locale ? records.filter(record => record.locale === locale) : records
  const cacheKey = createCacheKey(scopedRecords, locale, options)
  let index = searchIndexCache.get(cacheKey)
  if (!index) {
    index = createSearchIndex(options)
    index.addAll(scopedRecords)
    rememberSearchIndex(cacheKey, index)
  } else {
    rememberSearchIndex(cacheKey, index)
  }

  return index.search(term).map((result: MiniSearchResult) => {
    const storedFields = Object.fromEntries(options.storeFields.map(field => [field, result[field]]))
    return {
      ...storedFields,
      path: typeof result.path === 'string' ? result.path : '',
      title: typeof result.title === 'string' ? result.title : '',
      excerpt: typeof result.excerpt === 'string' ? result.excerpt : '',
      score: result.score,
      anchor: typeof result.anchor === 'string' ? result.anchor : undefined,
      locale: typeof result.locale === 'string' ? result.locale : undefined
    } satisfies ContentSearchResult
  })
}
