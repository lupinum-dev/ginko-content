export type ContentSearchEngine = 'minisearch' | 'pagefind' | 'provider'

export interface ContentMiniSearchOptions {
  /**
   * Fields indexed by MiniSearch.
   *
   * @default ['title', 'content', 'headings']
   */
  fields: string[]
  /**
   * Fields copied into search result payloads.
   *
   * @default ['path', 'title', 'excerpt', 'anchor', 'locale', 'collection']
   */
  storeFields: string[]
  /**
   * Per-field relevance boosts.
   *
   * @default { title: 4, headings: 2, content: 1 }
   */
  boost: Record<string, number>
  /**
   * MiniSearch fuzzy search setting.
   *
   * @default 0.2
   */
  fuzzy: number | boolean
  /**
   * Enable prefix matching.
   *
   * @default true
   */
  prefix: boolean
}

export interface ContentSearchPublicRuntimeConfig {
  apiBaseURL: string
  indexURL: string
  engine: ContentSearchEngine
  minisearch: ContentMiniSearchOptions
}

export interface ContentSearchIndexRecord {
  id: string
  collection: string
  path: string
  title: string
  excerpt: string
  content: string
  headings: string[]
  anchor?: string
  locale?: string
  [field: string]: unknown
}

export interface ContentSearchResult {
  collection: string
  path: string
  title: string
  excerpt: string
  score: number
  anchor?: string
  locale?: string
  [field: string]: unknown
}

export interface ContentProviderSearchRequest {
  term: string
  locale?: string
  collections?: string[]
}
