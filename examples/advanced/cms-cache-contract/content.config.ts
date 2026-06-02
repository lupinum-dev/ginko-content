import { defineCollection, defineContentConfig, fields } from '@lupinum/ginko-content/config'
import { z } from 'zod'

export const authors = defineCollection({
  type: 'page',
  source: 'authors/**/*.md',
  schema: z.object({
    name: fields.text().required()
  })
})

export const blog = defineCollection({
  type: 'page',
  source: 'blog/**/*.md',
  schema: z.object({
    title: fields.text().required(),
    author: fields.relation('authors').required()
  })
})

export default defineContentConfig({
  provider: 'cms-demo',
  providers: {
    'cms-demo': '~/server/cms-provider'
  },
  collections: {
    authors,
    blog
  }
})
