import type { H3Event } from 'h3'
import type {
  ContentCollectionItemSurroundingsOptions,
  ContentCollectionNavigationOptions
} from '../../types/query'
import { resolveCollectionItemSurroundingsData } from '../../features/collections/resolve'
import { resolveContentNavigation } from './navigation-query'
import { createCanonicalQueryPlan } from './provider-query'
import { contentConfig } from './storage-access'
import { projectNavigationTree } from '../../features/navigation/canonical'
import { resolveRuntimeCollectionLocalePolicy } from '../../features/localization/config'

export async function queryFilesystemCollectionNavigation (
  event: H3Event,
  collection: string,
  fieldsOrOptions: string[] | ContentCollectionNavigationOptions = []
) {
  const options = Array.isArray(fieldsOrOptions) ? { fields: fieldsOrOptions } : fieldsOrOptions
  const locale = options.locale
  const runtime = contentConfig()
  // One policy lookup feeds both plan compilation and route projection. This
  // path never leaves the process, so it compiles straight to the canonical
  // plan rather than mounting a provider wire query and unmounting it again.
  const localePolicy = resolveRuntimeCollectionLocalePolicy(collection, runtime)
  if (!localePolicy) {
    throw new Error(`Missing resolved locale policy for content collection "${collection}".`)
  }
  const navigation = await resolveContentNavigation(event, {
    collection,
    plan: createCanonicalQueryPlan({
      collection,
      ...(options.fields?.length ? { only: options.fields } : {}),
      ...(locale ? { resolveLocale: { locale, fallback: true } } : {})
    }, runtime, localePolicy)
  })
  return projectNavigationTree(navigation, {
    locale,
    localePolicy
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
