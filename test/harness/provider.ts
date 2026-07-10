import type { H3Event } from 'h3'
import type {
  ContentProvider,
  ContentProviderQuery,
  ProviderDocumentInput
} from '../../packages/content/src/public/provider'
import { SUPPORTED_QUERY_OPERATORS } from '../../packages/content/src/core/query/operators'
import { executeQueryPlan } from '../../packages/content/src/core/query/execute'
import { normalizeContentPath } from '../../packages/content/src/core/content/path'
import { createContentProviderError } from '../../packages/content/src/public/provider-errors'
import type { ParsedContent } from '../../packages/content/src/types/content'
import type { ContentQueryResponse } from '../../packages/content/src/types/api'
import type { ContentScenario } from './content-scenario'

const normalizeQueryResult = <T>(value: T | T[] | number | undefined): T[] => {
  if (Array.isArray(value)) return value
  return value && typeof value === 'object' ? [value] : []
}

/**
 * Small final-contract provider used by runtime and public-consumer tests.
 * It deliberately returns the same raw document and route facts a remote CMS
 * would return; production shaping remains exercised in Ginko core.
 */
export const createInMemoryProvider = (scenario: ContentScenario, name = 'in-memory'): ContentProvider => {
  const assertCollection = (collection?: string | null) => {
    if (collection && !scenario.collections[collection]) {
      throw createContentProviderError('unknown_collection', `Unknown collection: ${collection}`, { collection })
    }
  }

  const execute = (providerQuery: ContentProviderQuery) => {
    assertCollection(providerQuery.plan.collection)
    const plan = {
      ...providerQuery.plan,
      projection: {
        only: providerQuery.plan.projection.only.length
          ? [...new Set([
              ...providerQuery.plan.projection.only,
              'id', 'collection', 'canonicalKey', 'locale', 'path', 'resolved',
              'type', 'body', 'file'
            ])]
          : [],
        without: providerQuery.plan.projection.only.length ? [] : providerQuery.plan.projection.without
      }
    }
    return executeQueryPlan<ParsedContent>(scenario.graph, plan, scenario.runtime)
  }

  const routeVariantsFor = (document: ParsedContent) => scenario.documents
    .filter(candidate => candidate.canonicalKey === document.canonicalKey && candidate.path && candidate.locale)
    .map(candidate => ({
      locale: candidate.locale!,
      contentPath: normalizeContentPath(candidate.path!)
    }))

  const routeFact = (document: ParsedContent) => ({
    collection: document.collection || '',
    canonicalKey: document.canonicalKey || '',
    locale: document.locale || '',
    contentPath: normalizeContentPath(document.path || '/')
  })

  const toRawDocument = (document: ParsedContent): ProviderDocumentInput => {
    const { path, resolved, route, resolution, ...data } = document as ParsedContent & Record<string, unknown>
    void route
    void resolution
    return {
      ...data,
      id: document.id,
      collection: document.collection || '',
      canonicalKey: document.canonicalKey || '',
      locale: document.locale || '',
      contentPath: normalizeContentPath(path || '/'),
      routeVariants: routeVariantsFor(document),
      type: document.type,
      body: document.body ?? null,
      ...(document.file ? { file: document.file } : {}),
      ...(resolved ? { _fixtureResolution: resolved } : {})
    }
  }

  const mapQueryResponse = (response: ReturnType<typeof executeQueryPlan>) => {
    if (typeof response.result === 'number') return response
    if (Array.isArray(response.result)) {
      return { ...response, result: response.result.map(toRawDocument) }
    }
    return {
      ...response,
      result: response.result ? toRawDocument(response.result as ParsedContent) : response.result
    }
  }

  const documentsForNavigation = (providerQuery: ContentProviderQuery) => {
    const response = execute({
      ...providerQuery,
      plan: {
        ...providerQuery.plan,
        projection: { only: [], without: [] }
      }
    })
    return normalizeQueryResult(response.result as ParsedContent | ParsedContent[] | number | undefined)
      .filter(document => !document.partial && !document.navigationFile && document.navigation !== false && document.path)
  }

  return {
    name: name as ContentProvider['name'],
    capabilities: {
      query: {
        operators: [
          ...SUPPORTED_QUERY_OPERATORS.filter(operator => operator !== '$options'),
          '$and',
          '$or'
        ],
        pagination: ['offset', 'cursor']
      }
    },
    query: async <T>(_event: H3Event, providerQuery: ContentProviderQuery) =>
      mapQueryResponse(execute(providerQuery)) as unknown as ContentQueryResponse<T>,
    navigation: async (_event, providerQuery) => documentsForNavigation(providerQuery).map(document => ({
      title: String(document.title || ''),
      ...Object.fromEntries(providerQuery.plan.projection.only
        .filter(field => !['path', 'href', 'localePath', 'alternates', 'route', 'resolution'].includes(field) && field in document)
        .map(field => [field, (document as Record<string, unknown>)[field]])),
      route: routeFact(document)
    })),
    surroundings: async (_event, collection, contentPath, options = {}) => {
      assertCollection(collection)
      const documents = scenario.documents
        .filter(document => document.collection === collection && !document.draft && !document.partial && !document.navigationFile && document.path)
        .filter(document => !options.locale || document.locale === options.locale)
        .sort((left, right) => String(left.path).localeCompare(String(right.path)))
      const index = documents.findIndex(document => normalizeContentPath(document.path || '/') === normalizeContentPath(contentPath))
      if (index === -1) return [null, null]
      return [documents[index - 1] || null, documents[index + 1] || null].map(document => document
        ? { title: String(document.title || ''), route: routeFact(document) }
        : null)
    },
    search: async (_event, request) => {
      const term = request.term.toLocaleLowerCase()
      return scenario.documents
        .filter(document => !document.draft)
        .filter(document => !request.collections?.length || request.collections.includes(document.collection || ''))
        .filter(document => !request.locale || document.locale === request.locale)
        .filter(document => String(document.title || '').toLocaleLowerCase().includes(term))
        .map(document => ({
          score: 1,
          title: document.title || '',
          excerpt: String(document.description || ''),
          route: routeFact(document)
        }))
    },
    siteData: async (_event, request) => ({
      key: request.key,
      locale: request.locale,
      data: null
    }),
    routes: async () => scenario.documents
      .filter(document => scenario.collections[document.collection || '']?.type !== 'data')
      .filter(document => !document.partial && !document.navigationFile && document.path)
      .map(document => ({
        ...routeFact(document),
        ...(document.draft ? { draft: true } : {}),
        ...(document.sitemap === false ? { sitemap: false as const } : {})
      }))
  }
}
