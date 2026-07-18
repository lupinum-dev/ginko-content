import { createError, defineEventHandler, getQuery } from 'h3'
import { getContentProvider } from '../providers'
import { createContentProviderError } from '../../../public/provider-errors'
import { collectJsonPurityViolations } from '../../../core/json-value'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const invalidSiteDataResult = (provider: string, field: string): never => {
  throw createContentProviderError(
    'provider_result_invalid',
    `${provider} returned an invalid site-data response.`,
    { provider, operation: 'siteData', field }
  )
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const key = typeof query.key === 'string' ? query.key.trim() : ''
  const locale = typeof query.locale === 'string' ? query.locale : undefined

  if (!key) {
    throw createError({
      statusCode: 400,
      statusMessage: 'missing_site_data_key',
      message: 'A site-data key is required.'
    })
  }

  const provider = await getContentProvider(event)
  if (typeof provider.siteData !== 'function') {
    throw createContentProviderError('unsupported_provider_site_data', `${provider.name} does not support site data.`, {
      provider: provider.name
    })
  }

  const result = await provider.siteData(event, { key, locale })
  if (!isRecord(result)) {
    return invalidSiteDataResult(provider.name, 'result')
  }
  const unknownField = Object.keys(result).find(field => field !== 'data' && field !== 'updatedAt')
  if (unknownField) {
    return invalidSiteDataResult(provider.name, `result.${unknownField}`)
  }
  if (!Object.prototype.hasOwnProperty.call(result, 'data')) {
    return invalidSiteDataResult(provider.name, 'result.data')
  }
  if (
    result.updatedAt !== undefined &&
    (!Number.isSafeInteger(result.updatedAt) || (result.updatedAt as number) < 0)
  ) {
    return invalidSiteDataResult(provider.name, 'result.updatedAt')
  }

  if (collectJsonPurityViolations(result.data).length) {
    return invalidSiteDataResult(provider.name, 'result.data')
  }

  return {
    key,
    ...(locale === undefined ? {} : { locale }),
    data: result.data,
    ...(typeof result.updatedAt === 'number' ? { updatedAt: result.updatedAt } : {})
  }
})
