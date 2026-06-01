import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const movies = defineCollection('movies', { type: 'page', source: '*' })

export default defineContentConfig({
  collections: { movies }
})
