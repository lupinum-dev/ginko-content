import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'
import { z } from 'zod'

const providerModule = new URL('./server/provider.ts', import.meta.url).href

export const docs = defineCollection({
  type: 'page',
  source: 'docs/**/*.md',
  i18n: true,
  route: {
    en: '/docs',
    de: '/dokumentation'
  },
  strict: true,
  schema: z.object({
    title: z.string()
  })
})

export default defineContentConfig({
  provider: 'fixture-search',
  providers: {
    'fixture-search': providerModule
  },
  collections: { docs }
})
