import { defineEventHandler, getQuery } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { buildSearchIndex } from '../search'

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const searchConfig = runtimeConfig.content.search

  if (searchConfig === false) {
    return []
  }

  const query = getQuery(event)
  const locale = typeof query.locale === 'string' ? query.locale : undefined

  return await buildSearchIndex(event, {
    collections: searchConfig.collections,
    ignoredTags: searchConfig.ignoredTags || [],
    extraFields: searchConfig.extraFields || [],
    filterQuery: searchConfig.filterQuery,
    locale,
    allLocales: !locale
  })
})
