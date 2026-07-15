import MiniSearch from 'minisearch'
import type { SearchResult as MiniSearchResult } from 'minisearch'
import type { ContentMiniSearchOptions, ContentSearchIndexRecord, ContentSearchResult } from '../../types/search'
import { createSearchExcerpt } from '../../features/search/snippet'

const DEFAULT_SEARCH_OPTIONS: ContentMiniSearchOptions = {
  fields: ['title', 'content', 'headings'],
  storeFields: ['path', 'title', 'excerpt', 'anchor', 'locale', 'collection'],
  boost: {
    title: 4,
    headings: 2,
    content: 1
  },
  fuzzy: 0.2,
  prefix: true
}
const REQUIRED_STORE_FIELDS = ['path', 'title', 'excerpt', 'collection'] as const
interface SearchIndexEntry {
  index: MiniSearch<ContentSearchIndexRecord>
  recordsById: Map<string, ContentSearchIndexRecord>
}

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

/**
 * Build one immutable MiniSearch owner for one records snapshot. Callers own
 * its lifetime explicitly; changing a corpus means creating a new owner.
 */
export const createMiniSearchIndex = (
  records: readonly ContentSearchIndexRecord[],
  searchOptions?: Partial<ContentMiniSearchOptions>
) => {
  const options = resolveSearchOptions(searchOptions)
  const snapshot = records.map(record => ({
    ...record,
    headings: [...record.headings]
  }))
  const entries = new Map<string, SearchIndexEntry>()

  const entryFor = (locale?: string) => {
    const key = locale || ''
    const cached = entries.get(key)
    if (cached) return cached

    const scopedRecords = locale ? snapshot.filter(record => record.locale === locale) : snapshot
    const index = createSearchIndex(options)
    index.addAll(scopedRecords)
    const entry = {
      index,
      recordsById: new Map(scopedRecords.map(record => [record.id, record]))
    }
    entries.set(key, entry)
    return entry
  }

  return {
    search (term: string, execution: { locale?: string, limit?: number } = {}): ContentSearchResult[] {
      if (!term.trim()) return []

      const { index, recordsById } = entryFor(execution.locale)
      const ranked = index.search(term)
      const limited = typeof execution.limit === 'number' && execution.limit > 0
        ? ranked.slice(0, Math.floor(execution.limit))
        : ranked

      return limited.map((result: MiniSearchResult) => {
        const storedFields = Object.fromEntries(options.storeFields.map(field => [field, result[field]]))
        const record = recordsById.get(String(result.id))
        return {
          ...storedFields,
          path: typeof result.path === 'string' ? result.path : '',
          collection: typeof result.collection === 'string' ? result.collection : '',
          title: typeof result.title === 'string' ? result.title : '',
          excerpt: createSearchExcerpt(
            typeof record?.content === 'string' ? record.content : '',
            term,
            typeof result.excerpt === 'string' ? result.excerpt : ''
          ),
          score: result.score,
          anchor: typeof result.anchor === 'string' ? result.anchor : undefined,
          locale: typeof result.locale === 'string' ? result.locale : undefined
        } satisfies ContentSearchResult
      })
    }
  }
}
