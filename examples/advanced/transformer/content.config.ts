import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export default defineContentConfig({
  collections: {
    docs: defineCollection('docs', { type: 'page', source: '**/*' })
  }
})
