import { defineEventHandler, getQuery } from 'h3'
import { getContentProvider } from '../providers'
import { createContentProviderError } from '../../../public/provider-errors'
import { projectProviderNavigation } from '../provider-route-facts'
import { getContentRuntimeConfig } from '../runtime-config'
import { validateContentQueryRequestBody } from '../query-http-validation'
import { assertConfiguredProviderCollection, assertConfiguredProviderQueryLocales, createProviderQuery } from '../provider-query'
import { invalidContentQueryRequest, readContentQueryRequest } from '../query-request'

export default defineEventHandler(async (event) => {
  const query = await readContentQueryRequest(event)
  const params = getQuery(event)
  if (typeof params.collection === 'string' && !query.collection) {
    query.collection = params.collection
  }
  if (typeof params.locale === 'string' && !query.resolveLocale) {
    query.resolveLocale = { locale: params.locale }
  }
  const validated = validateContentQueryRequestBody(query)
  if (!validated.ok) {
    throw invalidContentQueryRequest(validated.error.path, validated.error.reason)
  }
  const providerQueryParams = validated.value
  if (!providerQueryParams.collection) {
    throw invalidContentQueryRequest('$.collection', 'collection must name a configured content collection.')
  }
  try {
    assertConfiguredProviderCollection(providerQueryParams.collection)
  } catch {
    throw invalidContentQueryRequest('$.collection', 'collection must name a configured content collection.')
  }
  assertConfiguredProviderQueryLocales(providerQueryParams)
  const provider = await getContentProvider(event)
  if (!provider.navigation) {
    throw createContentProviderError('unsupported_provider_operation', `${provider.name} does not support navigation queries`, {
      provider: provider.name
    })
  }
  const { resolveVariant: _resolveVariant, ...navigationParams } = providerQueryParams
  const providerQuery = createProviderQuery({
    ...navigationParams,
    collection: providerQueryParams.collection
  })
  return projectProviderNavigation(
    await provider.navigation(event, providerQuery),
    provider.name,
    getContentRuntimeConfig().content,
    providerQuery.plan.resolveLocale?.locale,
    providerQuery.collection || undefined
  )
})
