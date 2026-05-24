import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export default defineContentConfig({
  collections: {
    movies: defineCollection('movies', { type: 'page', source: '*' })
  }
})
