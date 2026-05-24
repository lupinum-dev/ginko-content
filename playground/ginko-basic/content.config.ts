import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const posts = defineCollection('posts', { type: 'data', source: 'blog/**/*.md' })
export const pages = defineCollection('pages', { type: 'page', source: ['index.md', 'manual.md', 'guide/**/*.md'] })
export const data = defineCollection('data', { type: 'data', source: 'data/*' })

export default defineContentConfig({
  collections: { posts, pages, data }
})
