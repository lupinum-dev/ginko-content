import type { ParsedContent } from '../../packages/content/src/types/content'
import type { ContentGraph } from '../../packages/content/src/core/content/graph'
import { buildContentGraph } from '../../packages/content/src/core/content/graph'
import {
  resolveLocalePolicy,
  type ResolvedCollectionLocalePolicy
} from '../../packages/content/src/features/localization/locale-policy'

export interface ContentScenarioCollection {
  type: 'page' | 'data'
  i18n?: boolean | { locales?: string[], defaultLocale?: string }
  route?: string | Record<string, string>
  sitemap?: boolean
  localePolicy?: ResolvedCollectionLocalePolicy
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

const createScenarioDocument = (
  input: Partial<ParsedContent> & Record<string, unknown>
): ParsedContent => {
  const collection = String(input.collection || 'docs')
  const locale = String(input.locale || 'en')
  const path = String(input.path || '/')
  const canonicalKey = String(input.canonicalKey || `${collection}:${trimSlashes(path) || 'index'}`)
  const extension = input.file?.extension || (input.type === 'yaml' ? 'yml' : 'md')

  return {
    id: String(input.id || `content:${locale}:${trimSlashes(path).replace(/\//g, ':') || 'index'}.${extension}`),
    collection: collection,
    locale: locale,
    canonicalKey: canonicalKey,
    path: path,
    type: (input.type || 'markdown') as ParsedContent['type'],
    file: {
      source: String(input.file?.source || 'content'),
      path: String(input.file?.path || `/${locale}/${trimSlashes(path) || 'index'}.${extension}`),
      extension: extension as NonNullable<ParsedContent['file']>['extension']
    },
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
  const localePolicy = resolveLocalePolicy({
    nuxtI18n: { installed: false },
    content: {
      defaultLocale,
      locales,
      fallback: localeFallback,
      translatedSlugs: false
    },
    collections: Object.entries(input.collections).map(([name, collection]) => ({
      name,
      localized: Boolean(collection.i18n),
      ...(collection.i18n && typeof collection.i18n === 'object'
        ? {
            locales: collection.i18n.locales,
            defaultLocale: collection.i18n.defaultLocale
          }
        : {}),
      route: collection.route
    }))
  })
  const collections = Object.fromEntries(
    Object.entries(input.collections).map(([name, collection]) => [
      name,
      { ...collection, localePolicy: localePolicy.collections[name] }
    ])
  )

  return {
    name: input.name || 'content-scenario',
    defaultLocale,
    locales,
    localeFallback,
    collections,
    documents,
    graph,
    runtime: {
      defaultLocale,
      locales,
      localeFallback,
      collections
    }
  }
}
