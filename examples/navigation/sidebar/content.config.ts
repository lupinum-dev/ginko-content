import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const docs = defineCollection({ type: 'page', source: 'docs/**/*.md', route: '/docs' })

export default defineContentConfig({
  collections: { docs }
})
