import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'
import { z } from 'zod'

export const pages = defineCollection({
  type: 'page',
  source: 'watched.md',
  schema: z.object({ cacheMarker: z.string().default('initial-schema') })
})

export default defineContentConfig({
  collections: { pages }
})
