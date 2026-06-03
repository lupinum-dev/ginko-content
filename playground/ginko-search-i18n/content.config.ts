import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'
import { z } from 'zod'

export const docs = defineCollection({
  type: 'page',
  source: '**/*.md',
  strict: true,
  schema: z.object({
    title: z.string()
  })
})

export default defineContentConfig({
  collections: { docs }
})
