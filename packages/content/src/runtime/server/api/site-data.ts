import { createError, defineEventHandler, getQuery } from 'h3'
import { getContentProvider } from '../providers'
import { createContentProviderError } from '../../../public/provider-errors'

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

  return await provider.siteData(event, { key, locale })
})
