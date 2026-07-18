import { createError, defineEventHandler, getQuery } from 'h3'
import { getContentQuery } from '../../utils/query'
import { getContentProvider } from '../providers'
import { toContentProviderNavigationQuery } from '../../../public/provider-query'
import { createContentProviderError } from '../../../public/provider-errors'
import { projectProviderNavigation } from '../provider-route-facts'
import { getContentRuntimeConfig } from '../runtime-config'
import { isOversizedQueryRequestBody, validateContentQueryRequestBody } from '../query-http-validation'
import { assertConfiguredProviderCollection, assertConfiguredProviderQueryLocales } from '../provider-query'

const invalidContentQueryRequest = (path: string, reason: string) => createError({
  statusCode: 400,
  statusMessage: 'invalid_content_query_request',
  message: `Invalid content query request at ${path}: ${reason}`,
  data: { code: 'invalid_content_query_request', path, reason }
})

export default defineEventHandler(async (event) => {
  const encoded = event.context.params?.params
  if (typeof encoded === 'string' && isOversizedQueryRequestBody(encoded)) {
    throw invalidContentQueryRequest('$', 'Request payload is too large.')
  }

  const query = getContentQuery(event)
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
  if (providerQueryParams.collection) {
    try {
      assertConfiguredProviderCollection(providerQueryParams.collection)
    } catch {
      throw invalidContentQueryRequest('$.collection', 'collection must name a configured content collection.')
    }
  }
  assertConfiguredProviderQueryLocales(providerQueryParams)
  const provider = await getContentProvider(event)
  if (!provider.navigation) {
    throw createContentProviderError('unsupported_provider_operation', `${provider.name} does not support navigation queries`, {
      provider: provider.name
    })
  }
  const { query: providerQuery, options } = toContentProviderNavigationQuery(providerQueryParams)
  return projectProviderNavigation(
    await provider.navigation(event, providerQuery, options),
    provider.name,
    getContentRuntimeConfig().content,
    options.locale,
    providerQuery.collection || undefined
  )
})
