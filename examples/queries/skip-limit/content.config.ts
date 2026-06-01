import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const posts = defineCollection('posts', { type: 'page', source: '*.md' })

export default defineContentConfig({
  collections: { posts }
})
