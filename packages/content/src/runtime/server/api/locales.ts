import { createError, defineEventHandler, getQuery } from 'h3'
import { resolveProviderContentVariants } from '../provider-query'

export default defineEventHandler(async (event) => {
  const identity = typeof getQuery(event).identity === 'string' ? getQuery(event).identity : ''
  const collection = event.context.params?.collection

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
        .filter((doc) => doc._canonicalKey === resolved.canonicalKey && typeof doc._locale === 'string')
        .sort((left, right) => String(left._locale).localeCompare(String(right._locale)))
        .map((doc) => ({
          canonicalKey: resolved.canonicalKey,
          locale: String(doc._locale),
          ...(typeof doc._path === 'string' ? { path: doc._path } : {}),
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
