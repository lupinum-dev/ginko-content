import type { H3Event } from 'h3'
import type { ParsedContent } from '../../types/content'
import type {
  ContentCollectionItemSurroundingsOptions,
  ContentCollectionNavigationOptions,
  ContentCollectionPageOptions,
  ContentCollectionRouteMetaOptions,
  ContentCollectionSearchSectionsOptions,
  ContentQueryBuilderWhere,
  ContentPageResult,
  ContentSearchSection
} from '../../types/query'
import { resolveCollectionItemSurroundingsData, resolveCollectionNavigationData, resolveCollectionPageData, resolveCollectionRouteMetaData, resolveCollectionSearchSectionsData } from '../../features/collections/resolve'
import { resolveContentNavigation } from './navigation-query'
import { executeFilesystemContentQuery } from './query-executor'
import { createProviderNavigationQuery, createProviderQuery } from './provider-query'
import { serverQueryCollection } from './storage'
import { contentConfig } from './storage-access'

const isNotFoundError = (error: unknown) => {
  return (error as { statusCode?: number })?.statusCode === 404
}

const searchPageFields = (fields: string[] = []): Array<Extract<keyof ParsedContent, string>> => [
  'path',
  'title',
  'description',
  'body',
  ...fields
]

const mergeFilterQuery = (
  filterQuery?: ContentQueryBuilderWhere,
  locale?: string
): ContentQueryBuilderWhere | undefined => {
  const localeFilter: ContentQueryBuilderWhere | undefined = locale ? { locale: locale } : undefined
  if (filterQuery && localeFilter) {
    return { $and: [filterQuery, localeFilter] }
  }

  return filterQuery || localeFilter
}

export async function queryFilesystemCollectionNavigation (
  event: H3Event,
  collection: string,
  fieldsOrOptions: string[] | ContentCollectionNavigationOptions = []
) {
  const options = Array.isArray(fieldsOrOptions) ? { fields: fieldsOrOptions } : fieldsOrOptions
  const locale = options.locale
  return await resolveCollectionNavigationData(collection, contentConfig(), {
    ...options,
    loadNavigation: () => {
      const { query, options: navigationOptions } = createProviderNavigationQuery({
        collection,
        ...(options.fields?.length ? { navigationFields: options.fields } : {}),
        ...(typeof options.canonical === 'boolean' ? { canonical: options.canonical } : {}),
        ...(locale ? { resolveLocale: { locale, fallback: true } } : {})
      })
      return resolveContentNavigation(event, query, navigationOptions)
    }
  })
}

export async function queryFilesystemCollectionItemSurroundings (
  event: H3Event,
  collection: string,
  path: string,
  opts: ContentCollectionItemSurroundingsOptions = {}
) {
  return await resolveCollectionItemSurroundingsData(collection, path, contentConfig(), {
    ...opts,
    loadNavigation: options => queryFilesystemCollectionNavigation(event, collection, options)
  })
}

export async function queryFilesystemCollectionSearchSections (
  event: H3Event,
  collection: string,
  opts: ContentCollectionSearchSectionsOptions = {}
): Promise<ContentSearchSection[]> {
  return await resolveCollectionSearchSectionsData(collection, contentConfig(), {
    ...opts,
    loadPages: async (extraFields) => {
      const query = serverQueryCollection(event, collection)
        .select(...searchPageFields(extraFields))
      const filterQuery = mergeFilterQuery(opts.filterQuery, opts.locale)
      if (filterQuery) {
        return await (query as any).where(filterQuery).all() as Array<Pick<ParsedContent, 'path' | 'title' | 'description' | 'body'> & Record<string, unknown>>
      }
      return await query
        .all() as Array<Pick<ParsedContent, 'path' | 'title' | 'description' | 'body'> & Record<string, unknown>>
    }
  })
}

export async function queryFilesystemCollectionPage<T = ParsedContent> (
  event: H3Event,
  collection: string,
  routeOrPath: string = '/',
  options: ContentCollectionPageOptions = {}
): Promise<ContentPageResult<T> | null> {
  return await resolveCollectionPageData<T>(collection, routeOrPath, contentConfig(), {
    ...options,
    loadVariantPage: async (input) => {
      try {
        const response = await executeFilesystemContentQuery<T & ParsedContent>(event, createProviderQuery({
          collection,
          first: true,
          resolveVariant: {
            path: input.path,
            locale: input.locale,
            fallback: input.fallback
          }
        }).plan)
        return (response.result as (T & ParsedContent) | undefined) || null
      }
      catch (error) {
        if (isNotFoundError(error)) {
          return null
        }

        throw error
      }
    },
    loadPathPage: async (path) => {
      try {
        return await serverQueryCollection(event, collection)
          .where('path', '=', path)
          .first() as (T & ParsedContent) | null
      }
      catch (error) {
        if (isNotFoundError(error)) {
          return null
        }

        throw error
      }
    }
  })
}

export async function queryFilesystemCollectionRouteMeta (
  event: H3Event,
  collection: string,
  routeOrPath: string = '/',
  options: ContentCollectionRouteMetaOptions = {}
) {
  return await resolveCollectionRouteMetaData(collection, contentConfig(), {
    routeOrPath,
    ...options,
    loadPage: (path, loadOptions) => queryFilesystemCollectionPage(event, collection, path, loadOptions)
  })
}

export const queryCollectionNavigation = queryFilesystemCollectionNavigation
export const queryCollectionItemSurroundings = queryFilesystemCollectionItemSurroundings
export const queryCollectionSearchSections = queryFilesystemCollectionSearchSections
export const queryCollectionPage = queryFilesystemCollectionPage
export const queryCollectionRouteMeta = queryFilesystemCollectionRouteMeta
