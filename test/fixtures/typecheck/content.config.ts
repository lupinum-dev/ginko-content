import { defineCollection, defineContentConfig, reference } from '@lupinum/ginko-content/config'
import { z } from 'zod'

export const docs = defineCollection({
  type: 'page',
  source: 'docs/**/*.md',
  i18n: { defaultLocale: 'en', locales: ['en', 'de'] },
  strict: true,
  schema: z.object({
    title: z.string(),
    author: reference('authors').optional(),
    related: reference('docs').optional()
  })
})

export const authors = defineCollection({
  type: 'data',
  source: 'authors/*.yml',
  i18n: true,
  schema: z.object({
    name: z.string(),
    role: z.string().optional()
  })
})

export const posts = defineCollection({
  type: 'page',
  source: 'posts/**/*.md',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    date: z.union([z.string(), z.date()]),
    authors: z.array(reference('authors'))
  })
})

export default defineContentConfig({
  collections: { docs, authors, posts }
})
