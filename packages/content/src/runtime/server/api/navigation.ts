import { defineEventHandler, getQuery } from 'h3'
import { getContentQuery } from '../../utils/query'
import { getContentProvider } from '../providers'
import { createProviderNavigationQuery } from '../provider-query'
import { createContentProviderError } from '../../../public/provider-errors'
import { projectProviderNavigation } from '../provider-route-facts'
import { getContentRuntimeConfig } from '../runtime-config'

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
  if (!provider.navigation) {
    throw createContentProviderError('unsupported_provider_operation', `${provider.name} does not support navigation queries`, {
      provider: provider.name
    })
  }
  const { query: providerQuery, options } = createProviderNavigationQuery(query)
  return projectProviderNavigation(
    await provider.navigation(event, providerQuery, options),
    provider.name,
    getContentRuntimeConfig().content,
    options.locale
  )
})
