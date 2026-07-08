import { createError, defineEventHandler, getQuery } from 'h3'
import { resolveProviderContentVariants } from '../provider-query'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const identity = typeof query.identity === 'string' ? query.identity : ''
  const params = event.context.params as { collection?: unknown } | undefined
  const collection = typeof params?.collection === 'string' ? params.collection : ''

  if (!collection || !identity) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing collection or identity'
    })
  }

  const resolved = await resolveProviderContentVariants(event, identity, {
    collection,
    exact: false
  })
  const locales = resolved
    ? resolved.variants
        .filter((doc) => doc.canonicalKey === resolved.canonicalKey && typeof doc.locale === 'string')
        .sort((left, right) => String(left.locale).localeCompare(String(right.locale)))
        .map((doc) => ({
          canonicalKey: resolved.canonicalKey,
          locale: String(doc.locale),
          ...(typeof doc.path === 'string' ? { path: doc.path } : {}),
        }))
    : []
  if (!locales.length) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Locale variants not found'
    })
  }

  return locales
})
