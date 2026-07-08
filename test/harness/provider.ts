import type { ContentProvider, ContentProviderQuery } from '../../packages/content/src/public/provider'
import { toContentProviderQuery } from '../../packages/content/src/public/provider'
import type { ContentQueryResponse } from '../../packages/content/src/types/api'
import type { NavItem, ParsedContent } from '../../packages/content/src/types/content'
import type { ContentQueryBuilderParams } from '../../packages/content/src/types/query'
import { executeQueryPlan } from '../../packages/content/src/core/query/execute'
import { SUPPORTED_QUERY_OPERATORS } from '../../packages/content/src/core/query/operators'
import { normalizeRouteMounts, projectContentPathToLocale } from '../../packages/content/src/features/localization/path'
import { createRouteMeta, localizePageResult } from '../../packages/content/src/features/localization/results'
import { createContentProviderError } from '../../packages/content/src/public/provider-errors'
import type { ContentScenario } from './content-scenario'

const unwrapResponseResult = <T>(response: ContentQueryResponse<T>): T | T[] | number | undefined =>
  response.result as T | T[] | number | undefined

const routeMountsFor = (scenario: ContentScenario, collection: string) => {
  const config = scenario.collections[collection]
  const collectionI18n = config?.i18n && typeof config.i18n === 'object' ? config.i18n : undefined
  return normalizeRouteMounts(
    config?.route,
    collectionI18n?.locales || scenario.locales,
    collectionI18n?.defaultLocale || scenario.defaultLocale
  )
}

const localizePath = (scenario: ContentScenario, collection: string, path: string, locale?: string) => {
  const config = scenario.collections[collection]
  const collectionI18n = config?.i18n && typeof config.i18n === 'object' ? config.i18n : undefined
  return projectContentPathToLocale(
    path,
    locale,
    collectionI18n?.defaultLocale || scenario.defaultLocale,
    routeMountsFor(scenario, collection)
  )
}

const normalizeQueryResult = <T>(value: T | T[] | number | undefined): T[] => {
  if (Array.isArray(value)) return value
  return value && typeof value === 'object' ? [value] : []
}

export const createInMemoryProvider = (scenario: ContentScenario, name = 'in-memory'): ContentProvider => {
  const assertCollection = (collection?: string) => {
    if (collection && !scenario.collections[collection]) {
      throw createContentProviderError('unknown_collection', `Unknown collection: ${collection}`, { collection })
    }
  }

  const query: ContentProvider['query'] = async (_event, providerQuery: ContentProviderQuery) => {
    assertCollection(providerQuery.plan.collection)

    return executeQueryPlan(
      scenario.graph,
      providerQuery.plan,
      scenario.runtime
    )
  }

  const queryWithParams = <T = ParsedContent>(event: any, params: ContentQueryBuilderParams) =>
    query<T>(event, toContentProviderQuery(params))

const docsForNavigation = async (event: any, params: ContentQueryBuilderParams) => {
    const response = await queryWithParams<ParsedContent>(event, params)
    return normalizeQueryResult<ParsedContent>(unwrapResponseResult(response))
      .filter(doc => !doc.draft && !doc.partial && !doc._navigation && doc.navigation !== false && doc.path)
  }

  const provider: ContentProvider = {
    name: name as ContentProvider['name'],
    capabilities: {
      routeBackedCollections: true,
      dataCollections: true,
      localizedRoutes: true,
      translatedSlugs: true,
      navigation: true,
      surroundings: true,
      searchSections: true,
      sitemap: true,
      query: {
        operators: [...SUPPORTED_QUERY_OPERATORS],
        limit: true,
        skip: true,
        count: true
      }
    },
    query,
    navigationQuery: async (event, providerQuery, navigationOptions = {}) => {
      const response = await query<ParsedContent>(event, providerQuery)
      const docs = normalizeQueryResult<ParsedContent>(unwrapResponseResult(response))
        .filter(doc => !doc.draft && !doc.partial && !doc._navigation && doc.navigation !== false && doc.path)
      const collection = providerQuery.collection ?? undefined
      const queryLocale = navigationOptions.resolveLocale?.locale
      return docs.map(doc => ({
        title: doc.title,
        path: localizePath(scenario, doc.collection || collection || '', doc.path || '/', queryLocale || doc.resolved?.requestedLocale || doc.locale),
        locale: doc.locale
      })) as NavItem[]
    },
    navigation: async (event, collection, options = {}) => {
      assertCollection(collection)
      const locale = typeof options === 'object' && !Array.isArray(options) ? options.locale : undefined
      const docs = await docsForNavigation(event, {
        collection,
        resolveLocale: locale
          ? {
              locale,
              fallback: scenario.localeFallback[locale] || [scenario.defaultLocale]
            }
          : undefined,
        sort: [{ path: 1 }]
      })
      return docs.map(doc => ({
        title: doc.title,
        path: localizePath(scenario, collection, doc.path || '/', locale || doc.locale),
        locale: doc.locale
      })) as NavItem[]
    },
    surroundings: async (event, collection, path, options = {}) => {
      assertCollection(collection)
      const locale = options.locale
      const docs = await docsForNavigation(event, {
        collection,
        resolveLocale: locale
          ? {
              locale,
              fallback: scenario.localeFallback[locale] || [scenario.defaultLocale]
            }
          : undefined,
        sort: [{ path: 1 }]
      })
      const index = docs.findIndex(doc => doc.path === path || localizePath(scenario, collection, doc.path || '/', locale || doc.locale) === path)
      if (index === -1) return [null, null]
      return [docs[index - 1] || null, docs[index + 1] || null].map(doc => doc
        ? {
            title: doc.title,
            path: localizePath(scenario, collection, doc.path || '/', locale || doc.locale)
          }
        : null) as Array<NavItem | null>
    },
    searchSections: async (event, collection, options = {}) => {
      assertCollection(collection)
      const docs = await docsForNavigation(event, {
        collection,
        resolveLocale: options.locale
          ? {
              locale: options.locale,
              fallback: scenario.localeFallback[options.locale] || [scenario.defaultLocale]
            }
          : undefined
      })
      return docs.map(doc => ({
        id: localizePath(scenario, collection, doc.path || '/', options.locale || doc.locale),
        title: doc.title || '',
        titles: [doc.title || ''],
        content: String(doc.description || doc.title || '')
      }))
    },
    search: async (_event, request) => {
      const term = request.term.toLocaleLowerCase()
      return scenario.documents
        .filter(doc => !request.locale || doc.locale === request.locale)
        .filter(doc => String(doc.title || '').toLocaleLowerCase().includes(term))
        .map(doc => ({
          score: 1,
          collection: doc.collection || '',
          title: doc.title || '',
          excerpt: String(doc.description || ''),
          path: doc.path || '/',
          locale: doc.locale
        }))
    },
    siteData: async (_event, request) => ({
      key: request.key,
      locale: request.locale,
      data: null
    }),
    page: async (event, collection, routeOrPath = '/', options = {}) => {
      assertCollection(collection)
      if (scenario.collections[collection]?.type === 'data') {
        throw createContentProviderError('data_collection_route_access', `${collection} is a data collection.`, { collection })
      }
      const response = await queryWithParams<ParsedContent>(event, {
        collection,
        first: true,
        resolveVariant: {
          route: routeOrPath,
          locale: options.locale,
          fallback: options.fallback === false ? [] : scenario.localeFallback[options.locale || ''] || [scenario.defaultLocale],
          exact: options.exact
        }
      } as ContentQueryBuilderParams)
      const doc = unwrapResponseResult<ParsedContent>(response) as ParsedContent | undefined
      if (!doc) return null
      return localizePageResult(
        doc,
        options.locale || doc.resolved?.locale || doc.locale,
        scenario.defaultLocale,
        scenario.locales,
        routeMountsFor(scenario, collection)
      )
    },
    routeMeta: async (event, collection, routeOrPath = '/', options = {}) => {
      const page = await provider.page(event, collection, routeOrPath, options)
      return page
        ? createRouteMeta(page, options.locale || page.locale, scenario.defaultLocale, routeMountsFor(scenario, collection))
        : null
    },
    sitemapEntries: async (_event, options = {}) => {
      const include = options.include?.length ? options.include : Object.keys(scenario.collections)
      const entries = []
      for (const collection of include) {
        assertCollection(collection)
        if (scenario.collections[collection]?.type === 'data' || scenario.collections[collection]?.sitemap === false) {
          throw createContentProviderError('data_collection_sitemap_access', `${collection} cannot be listed in the sitemap.`, { collection })
        }
        for (const doc of scenario.documents.filter(doc => doc.collection === collection && !doc.draft && !doc.partial && !doc._navigation)) {
          entries.push({
            loc: localizePath(scenario, collection, doc.path || '/', doc.locale)
          })
        }
      }
      return entries
    }
  }

  return provider
}
