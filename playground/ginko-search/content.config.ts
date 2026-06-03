import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const pages = defineCollection({ type: 'page', source: ['index.md', 'guide/**/*.md'] })
export const posts = defineCollection({ type: 'page', source: 'posts/**/*.md' })

export default defineContentConfig({
  collections: { pages, posts }
})
