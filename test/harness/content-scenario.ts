import type { ParsedContent } from '../../packages/content/src/types/content'
import type { ContentGraph } from '../../packages/content/src/core/content/graph'
import { buildContentGraph } from '../../packages/content/src/core/content/graph'

export interface ContentScenarioCollection {
  type: 'page' | 'data'
  i18n?: boolean | { locales?: string[], defaultLocale?: string }
  route?: string | Record<string, string>
  sitemap?: boolean
}

export interface ContentScenarioInput {
  name?: string
  defaultLocale?: string
  locales?: string[]
  localeFallback?: Record<string, string[]>
  collections: Record<string, ContentScenarioCollection>
  documents: Array<Partial<ParsedContent> & Record<string, unknown>>
}

export interface ContentScenario {
  name: string
  defaultLocale: string
  locales: string[]
  localeFallback: Record<string, string[]>
  collections: Record<string, ContentScenarioCollection>
  documents: ParsedContent[]
  graph: ContentGraph
  runtime: {
    defaultLocale: string
    locales: string[]
    localeFallback: Record<string, string[]>
    collections: Record<string, ContentScenarioCollection>
  }
}

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '')

export const createScenarioDocument = (
  input: Partial<ParsedContent> & Record<string, unknown>
): ParsedContent => {
  const collection = String(input._collection || 'docs')
  const locale = String(input._locale || 'en')
  const path = String(input._path || '/')
  const canonicalKey = String(input._canonicalKey || `${collection}:${trimSlashes(path) || 'index'}`)
  const extension = input._extension || (input._type === 'yaml' ? 'yml' : 'md')

  return {
    _id: String(input._id || `content:${locale}:${trimSlashes(path).replace(/\//g, ':') || 'index'}.${extension}`),
    _source: String(input._source || 'content'),
    _collection: collection,
    _locale: locale,
    _canonicalKey: canonicalKey,
    _path: path,
    _file: String(input._file || `/${locale}/${trimSlashes(path) || 'index'}.${extension}`),
    _type: (input._type || 'markdown') as ParsedContent['_type'],
    _extension: extension as ParsedContent['_extension'],
    title: String(input.title || canonicalKey),
    body: {
      type: 'root',
      children: []
    },
    ...input
  } as ParsedContent
}

export const createContentScenario = (input: ContentScenarioInput): ContentScenario => {
  const defaultLocale = input.defaultLocale || 'en'
  const locales = input.locales?.length ? input.locales : [defaultLocale]
  const documents = input.documents.map(createScenarioDocument)
  const graph = buildContentGraph(documents, { defaultLocale, locales })
  const localeFallback = input.localeFallback || Object.fromEntries(
    locales
      .filter(locale => locale !== defaultLocale)
      .map(locale => [locale, [defaultLocale]])
  )

  return {
    name: input.name || 'content-scenario',
    defaultLocale,
    locales,
    localeFallback,
    collections: input.collections,
    documents,
    graph,
    runtime: {
      defaultLocale,
      locales,
      localeFallback,
      collections: input.collections
    }
  }
}
