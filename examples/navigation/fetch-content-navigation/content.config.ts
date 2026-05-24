import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export default defineContentConfig({
  collections: {
    pages: defineCollection('pages', { type: 'page', source: '**/*.md' })
  }
})
