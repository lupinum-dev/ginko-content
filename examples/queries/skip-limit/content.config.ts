import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export default defineContentConfig({
  collections: {
    posts: defineCollection('posts', { type: 'page', source: '*.md' })
  }
})
