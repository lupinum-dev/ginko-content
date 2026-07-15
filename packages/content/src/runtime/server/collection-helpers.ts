import type { H3Event } from 'h3'
import type {
  ContentCollectionItemSurroundingsOptions,
  ContentCollectionNavigationOptions
} from '../../types/query'
import { resolveCollectionItemSurroundingsData, resolveCollectionNavigationData } from '../../features/collections/resolve'
import { resolveContentNavigation } from './navigation-query'
import { createProviderNavigationQuery } from './provider-query'
import { contentConfig } from './storage-access'

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
