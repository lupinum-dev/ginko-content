import type { H3Event } from 'h3'
import type {
  ContentCollectionItemSurroundingsOptions,
  ContentCollectionNavigationOptions
} from '../../types/query'
import { resolveCollectionItemSurroundingsData, resolveCollectionNavigationData } from '../../features/collections/resolve'
import { resolveContentNavigation } from './navigation-query'
import { createProviderNavigationQuery } from './provider-query'
import { contentConfig } from './storage-access'
import { markCollectionNavigationRoot, projectNavigationTree } from '../../features/navigation/canonical'
import { normalizeRouteMounts } from '../../features/localization/path'

export async function queryFilesystemCollectionNavigation (
  event: H3Event,
  collection: string,
  fieldsOrOptions: string[] | ContentCollectionNavigationOptions = []
) {
  const options = Array.isArray(fieldsOrOptions) ? { fields: fieldsOrOptions } : fieldsOrOptions
  const locale = options.locale
  return await resolveCollectionNavigationData(collection, contentConfig(), {
    ...options,
    loadNavigation: async () => {
      const { query, options: navigationOptions } = createProviderNavigationQuery({
        collection,
        ...(options.fields?.length ? { navigationFields: options.fields } : {}),
        ...(typeof options.canonical === 'boolean' ? { canonical: options.canonical } : {}),
        ...(locale ? { resolveLocale: { locale, fallback: true } } : {})
      })
      const navigation = await resolveContentNavigation(event, query, navigationOptions)
      const runtime = contentConfig()
      const collectionI18n = runtime.collections?.[collection]?.i18n
      const locales = collectionI18n && typeof collectionI18n === 'object' && collectionI18n.locales?.length
        ? collectionI18n.locales
        : (runtime.locales || [])
      const defaultLocale = collectionI18n && typeof collectionI18n === 'object'
        ? collectionI18n.defaultLocale || runtime.defaultLocale
        : runtime.defaultLocale
      const routeMounts = normalizeRouteMounts(runtime.collections?.[collection]?.route, locales, defaultLocale)
      const marked = markCollectionNavigationRoot(navigation, collection, { routeMounts })
      return projectNavigationTree(marked, {
        locale,
        defaultLocale,
        routeMounts,
        collection,
        canonical: options.canonical
      })
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
