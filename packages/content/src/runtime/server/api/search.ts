import { defineEventHandler, getQuery, getRequestURL } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { buildSearchIndex, searchRecords } from '../search'
import { getContentProvider } from '../providers'
import { createContentProviderError } from '../../../public/provider-errors'

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event)
  const searchConfig = runtimeConfig.content.search

  if (searchConfig === false) {
    return []
  }

  const query = getQuery(event)
  const rawUrl = event.node.req.originalUrl || event.node.req.url
  const requestUrl = rawUrl ? new URL(rawUrl, 'http://content.local') : getRequestURL(event)
  const rawTerm = typeof query.q === 'string' ? query.q : requestUrl.searchParams.get('q')
  const term = typeof rawTerm === 'string' ? rawTerm.slice(0, 200) : ''
  const locale = typeof query.locale === 'string' ? query.locale : undefined

  if (searchConfig.engine === 'cms') {
    const provider = await getContentProvider(event)
    if (typeof provider.search !== 'function') {
      throw createContentProviderError('unsupported_provider_search', `${provider.name} does not support provider-backed search`, {
        provider: provider.name
      })
    }

    return await provider.search(event, {
      term,
      locale,
      collections: searchConfig.collections
    })
  }

  const records = await buildSearchIndex(event, {
    collections: searchConfig.collections,
    ignoredTags: searchConfig.ignoredTags || [],
    extraFields: searchConfig.extraFields || [],
    filterQuery: searchConfig.filterQuery,
    locale,
    allLocales: !locale
  })

  return searchRecords(records, term, locale, searchConfig.minisearch)
})
