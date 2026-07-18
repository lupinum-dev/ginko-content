import type { H3Event } from 'h3'
import type {
  ContentCollectionItemSurroundingsOptions,
  ContentCollectionNavigationOptions
} from '../../types/query'
import { resolveCollectionItemSurroundingsData } from '../../features/collections/resolve'
import { resolveContentNavigation } from './navigation-query'
import { toContentProviderNavigationQuery } from '../../public/provider-query'
import { contentConfig } from './storage-access'
import { markCollectionNavigationRoot, projectNavigationTree } from '../../features/navigation/canonical'
import { normalizeRouteMounts } from '../../features/localization/path'
import { resolveRuntimeCollectionI18nConfig } from '../../features/localization/config'

export async function queryFilesystemCollectionNavigation (
  event: H3Event,
  collection: string,
  fieldsOrOptions: string[] | ContentCollectionNavigationOptions = []
) {
  const options = Array.isArray(fieldsOrOptions) ? { fields: fieldsOrOptions } : fieldsOrOptions
  const locale = options.locale
  const { query, options: navigationOptions } = toContentProviderNavigationQuery({
    collection,
    ...(options.fields?.length ? { only: options.fields } : {}),
    ...(locale ? { resolveLocale: { locale, fallback: true } } : {})
  })
  const navigation = await resolveContentNavigation(event, query, navigationOptions)
  const runtime = contentConfig()
  const collectionI18n = resolveRuntimeCollectionI18nConfig(collection, runtime)
  const locales = collectionI18n?.locales || []
  const defaultLocale = collectionI18n?.defaultLocale
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
