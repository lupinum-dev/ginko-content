import { defineEventHandler, getQuery } from 'h3'
import { getContentQuery } from '../../utils/query'
import { getContentProvider } from '../providers'
import { createContentProviderError } from '../../../public/provider-errors'

export default defineEventHandler(async (event) => {
  const query = getContentQuery(event)
  const params = getQuery(event)
  if (typeof params.collection === 'string' && !query.collection) {
    query.collection = params.collection
  }
  if (typeof params.locale === 'string' && !query.resolveLocale) {
    query.resolveLocale = { locale: params.locale }
  }
  const provider = await getContentProvider(event)
  if (!provider.navigationQuery) {
    throw createContentProviderError('unsupported_provider_operation', `${provider.name} does not support navigation queries`, {
      provider: provider.name
    })
  }
  return await provider.navigationQuery(event, query)
})
