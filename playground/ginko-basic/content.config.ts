import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const posts = defineCollection({ type: 'data', source: 'blog/**/*.md' })
export const pages = defineCollection({ type: 'page', source: ['index.md', 'manual.md', 'guide/**/*.md'] })
export const data = defineCollection({ type: 'data', source: 'data/*' })

export default defineContentConfig({
  collections: { posts, pages, data }
})
