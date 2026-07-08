import { defineEventHandler } from 'h3'
import { getContentQuery } from '../../utils/query'
import { getContentProvider } from '../providers'
import { createProviderQuery, normalizeProviderQueryResponse } from '../provider-query'

export default defineEventHandler(async (event) => {
  const query = getContentQuery(event)
  const provider = await getContentProvider(event)
  return normalizeProviderQueryResponse(query, await provider.query(event, createProviderQuery(query)), provider.name)
})
