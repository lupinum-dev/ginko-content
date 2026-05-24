import { defineEventHandler, getQuery } from 'h3'
import { one } from '#content/server'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const reference = typeof query.reference === 'string' ? query.reference : 'guide/advanced'
  const locale = typeof query.locale === 'string' ? query.locale : undefined
  const fallback = query.fallback === 'true'

  const resolved = await one('docs', {
    locale,
    fallback,
    by: { ref: reference }
  } as Parameters<typeof one>[1])

  if (!resolved) return null
  const doc = resolved as Record<string, unknown>
  return {
    title: doc.title,
    path: doc._path,
    requestedLocale: doc._requestedLocale,
    resolvedLocale: doc._resolvedLocale,
    fallback: doc._fallback,
    availableLocales: doc._availableLocales,
    variantPaths: doc._variantPaths
  }
})
