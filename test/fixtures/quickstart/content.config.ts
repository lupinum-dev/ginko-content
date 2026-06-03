import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export default defineContentConfig({
  collections: {
    pages: defineCollection({
      type: 'page',
      source: '**/*.md'
    })
  }
})
