import type { ContentMiniSearchOptions } from '../../types/search'

export const REQUIRED_MINISEARCH_STORE_FIELDS = ['path', 'title', 'excerpt', 'collection'] as const

export const DEFAULT_MINISEARCH_OPTIONS: Readonly<ContentMiniSearchOptions> = {
  fields: ['title', 'content', 'headings'],
  storeFields: ['path', 'title', 'excerpt', 'collection', 'anchor', 'locale'],
  boost: {
    title: 4,
    headings: 2,
    content: 1
  },
  fuzzy: 0.2,
  prefix: true
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const stringList = (value: unknown) => Array.isArray(value)
  ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0)))
  : []

export const normalizeMiniSearchOptions = (value: unknown = {}): ContentMiniSearchOptions => {
  const options = isRecord(value) ? value : {}
  const fields = stringList(options.fields)
  const storeFields = stringList(options.storeFields)
  const boost = isRecord(options.boost)
    ? Object.fromEntries(Object.entries(options.boost)
        .filter((entry): entry is [string, number] => entry[0].length > 0 && typeof entry[1] === 'number' && Number.isFinite(entry[1])))
    : {}

  return {
    fields: fields.length ? fields : [...DEFAULT_MINISEARCH_OPTIONS.fields],
    storeFields: Array.from(new Set([
      ...REQUIRED_MINISEARCH_STORE_FIELDS,
      ...(storeFields.length ? storeFields : DEFAULT_MINISEARCH_OPTIONS.storeFields)
    ])),
    boost: Object.keys(boost).length ? boost : { ...DEFAULT_MINISEARCH_OPTIONS.boost },
    fuzzy: typeof options.fuzzy === 'boolean' || (typeof options.fuzzy === 'number' && Number.isFinite(options.fuzzy))
      ? options.fuzzy
      : DEFAULT_MINISEARCH_OPTIONS.fuzzy,
    prefix: typeof options.prefix === 'boolean' ? options.prefix : DEFAULT_MINISEARCH_OPTIONS.prefix
  }
}
