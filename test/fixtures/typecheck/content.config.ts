import { defineCollection, defineContentConfig, reference } from '@lupinum/ginko-content/config'
import { z } from 'zod'

export const docs = defineCollection('docs', {
  type: 'page',
  source: 'docs/**/*.md',
  strict: true,
  schema: z.object({
    title: z.string(),
    related: reference('docs').optional()
  })
})

export const authors = defineCollection('authors', {
  type: 'data',
  source: 'authors/*.yml',
  i18n: true
})

export default defineContentConfig({
  collections: { docs, authors }
})
