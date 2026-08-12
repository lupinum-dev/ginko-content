import MiniSearch from 'minisearch'
import type { SearchResult as MiniSearchResult } from 'minisearch'
import type { ContentMiniSearchOptions, ContentSearchIndexRecord, ContentSearchResult } from '../../types/search'
import { createSearchExcerpt } from '../../features/search/snippet'
import { normalizeMiniSearchOptions } from '../../features/search/options'
interface SearchIndexEntry {
  index: MiniSearch<ContentSearchIndexRecord>
  recordsById: Map<string, ContentSearchIndexRecord>
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
  const options = normalizeMiniSearchOptions(searchOptions)
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
