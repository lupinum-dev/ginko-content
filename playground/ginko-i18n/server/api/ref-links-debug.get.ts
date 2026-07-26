import { defineEventHandler, getQuery } from 'h3'

export default defineEventHandler(async (event) => {
  const { one, many } = await import('#content/server')
  const localeRaw = getQuery(event).locale
  const locale = typeof localeRaw === 'string' ? localeRaw : 'en'

  // `by: { path }` is canonical and mount-agnostic: the `docs` collection is
  // mounted at `/guide` (en) and `/leitfaden` (de), so its index is `/` in
  // both locales, not the mounted directory name.
  const home = await one(event, 'docs' as any, {
    locale,
    fallback: true,
    by: { path: '/' }
  })

  const gettingStarted = (await many(event, 'docs' as any, {
    locale,
    fallback: true,
    where: { canonicalKey: '1' as any },
    limit: 1
  }))[0] || null

  return { home, gettingStarted }
})
