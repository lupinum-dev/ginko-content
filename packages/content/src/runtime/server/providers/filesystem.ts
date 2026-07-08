import type { H3Event } from 'h3'
import type { ParsedContent } from '../../../types/content'
import type {
  ContentCollectionItemSurroundingsOptions,
  ContentCollectionNavigationOptions,
  ContentCollectionPageOptions,
  ContentCollectionRouteMetaOptions,
  ContentCollectionSearchSectionsOptions
} from '../../../types/query'
import type { QueryCollectionsSitemapEntriesOptions } from '../../../features/sitemap/query'
import type { ContentProvider } from '../../../public/provider'
import { SUPPORTED_QUERY_OPERATORS } from '../../../core/query/operators'
import { executeFilesystemContentQuery } from '../query-executor'
import { resolveContentNavigation } from '../navigation-query'
import {
  queryFilesystemCollectionItemSurroundings,
  queryFilesystemCollectionNavigation,
  queryFilesystemCollectionPage,
  queryFilesystemCollectionRouteMeta,
  queryFilesystemCollectionSearchSections
} from '../collection-helpers'
import { queryFilesystemCollectionsSitemapEntries } from '../sitemap'

export const filesystemProvider: ContentProvider = {
  name: 'filesystem',
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
      operators: [
        ...SUPPORTED_QUERY_OPERATORS.filter(operator => operator !== '$options'),
        '$and',
        '$or'
      ],
      limit: true,
      skip: true,
      count: true
    }
  },
  query: <T = ParsedContent>(event: H3Event, query: import('../../../public/provider').ContentProviderQuery) =>
    executeFilesystemContentQuery<T>(event, query.plan),
  navigationQuery: (event: H3Event, query, options) => resolveContentNavigation(event, query, options),
  navigation: (event: H3Event, collection: string, options?: string[] | ContentCollectionNavigationOptions) =>
    queryFilesystemCollectionNavigation(event, collection, options),
  surroundings: (event: H3Event, collection: string, path: string, options?: ContentCollectionItemSurroundingsOptions) =>
    queryFilesystemCollectionItemSurroundings(event, collection, path, options),
  searchSections: (event: H3Event, collection: string, options?: ContentCollectionSearchSectionsOptions) =>
    queryFilesystemCollectionSearchSections(event, collection, options),
  page: <T = ParsedContent>(event: H3Event, collection: string, routeOrPath?: string, options?: ContentCollectionPageOptions) =>
    queryFilesystemCollectionPage<T>(event, collection, routeOrPath, options),
  routeMeta: (event: H3Event, collection: string, routeOrPath?: string, options?: ContentCollectionRouteMetaOptions) =>
    queryFilesystemCollectionRouteMeta(event, collection, routeOrPath, options),
  sitemapEntries: (event: H3Event, options?: QueryCollectionsSitemapEntriesOptions) =>
    queryFilesystemCollectionsSitemapEntries(event, options)
}
