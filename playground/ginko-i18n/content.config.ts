import { defineCollection, defineContentConfig, reference } from '@lupinum/ginko-content/config'
import { z } from 'zod'

export const docs = defineCollection({
  type: 'page',
  source: '**/*.md',
  i18n: true,
  route: {
    en: '/guide',
    de: '/leitfaden'
  },
  strict: true,
  schema: z.object({
    title: z.string(),
    related: reference('docs').optional()
  })
})

export const authors = defineCollection({
  type: 'data',
  source: 'authors/*.yml',
  i18n: true,
  strict: true,
  schema: z.object({
    name: z.string(),
    role: z.string().optional(),
    profile: z.object({
      focus: z.string(),
      localeLabel: z.string()
    })
  })
})

export default defineContentConfig({
  collections: { docs, authors }
})
