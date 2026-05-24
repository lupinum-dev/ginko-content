import { defineEventHandler, getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  const { one, many } = await import('#content/server')
  const localeRaw = getQuery(event).locale
  const locale = typeof localeRaw === 'string' ? localeRaw : 'en'

  const home = await one('docs' as any, {
    locale,
    fallback: true,
    by: { path: '/' }
  })

  const gettingStarted = (await many('docs' as any, {
    locale,
    fallback: true,
    where: { _canonicalKey: '1/1' as any },
    limit: 1
  }))[0] || null

  return { home, gettingStarted }
})
