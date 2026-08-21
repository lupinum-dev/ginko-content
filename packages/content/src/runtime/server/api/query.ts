import { defineEventHandler } from 'h3'
import { getContentProvider } from '../providers'
import {
  assertConfiguredProviderCollection,
  createProviderQuery,
  normalizeProviderQueryResponse
} from '../provider-query'
import { validateContentQueryRequestBody } from '../query-http-validation'
import { invalidContentQueryRequest, readContentQueryRequest } from '../query-request'
import { projectPublicQueryResponse } from '../../../features/query/responses'

export default defineEventHandler(async (event) => {
  // Applies HTTP resource bounds, then delegates the accepted language to the
  // canonical query lowerer before provider dispatch. The payload arrives as
  // a path segment (GET) or a JSON body (POST) — see `readContentQueryRequest`.
  const decoded = await readContentQueryRequest(event)
  const validated = validateContentQueryRequestBody(decoded)
  if (!validated.ok) {
    throw invalidContentQueryRequest(validated.error.path, validated.error.reason)
  }

  const query = validated.value
  if (!query.collection) {
    throw invalidContentQueryRequest('$.collection', 'collection is required for the public query endpoint.')
  }
  try {
    assertConfiguredProviderCollection(query.collection)
  } catch {
    throw invalidContentQueryRequest('$.collection', 'collection must name a configured content collection.')
  }
  const provider = await getContentProvider(event)
  const response = normalizeProviderQueryResponse(query, await provider.query(event, createProviderQuery(query)), provider.name)
  return projectPublicQueryResponse(response, query.first === true)
})
