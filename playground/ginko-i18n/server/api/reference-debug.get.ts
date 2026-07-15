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
  const route = doc.route as Record<string, unknown> | undefined
  const resolution = doc.resolution as Record<string, unknown> | undefined
  const resolvedInfo = resolution?.resolved as Record<string, unknown> | undefined
  const requestedInfo = resolution?.requested as Record<string, unknown> | undefined
  return {
    title: doc.title,
    path: route?.resolvedPath,
    requestedLocale: requestedInfo?.locale,
    resolvedLocale: resolvedInfo?.locale,
    usedFallback: resolution?.usedFallback,
    alternates: route?.alternates
  }
})
