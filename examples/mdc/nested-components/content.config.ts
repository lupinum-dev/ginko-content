import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const pages = defineCollection('pages', { type: 'page', source: '*.md' })

export default defineContentConfig({
  collections: { pages }
})
