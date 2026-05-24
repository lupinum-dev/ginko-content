import { defineEventHandler } from 'h3'
import { many } from '#content/server'

export default defineEventHandler(async () => {
  const implicit = await many('docs' as any, {
    where: { _navigation: { $ne: true }, _partial: { $ne: true } }
  })

  const strictGerman = await many('docs' as any, {
    locale: 'de',
    where: { _navigation: { $ne: true }, _partial: { $ne: true } }
  })

  const fallbackGerman = await many('docs' as any, {
    locale: 'de',
    fallback: true,
    where: { _navigation: { $ne: true }, _partial: { $ne: true } }
  })

  return {
    implicit: (implicit || []).map((doc: any) => doc.title),
    strictGerman: (strictGerman || []).map((doc: any) => doc.title),
    fallbackGerman: (fallbackGerman || []).map((doc: any) => doc.title)
  }
})
