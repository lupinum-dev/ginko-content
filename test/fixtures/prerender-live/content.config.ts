import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const docs = defineCollection({
  type: 'page',
  source: 'docs/**/*.md',
  route: '/docs'
})

// Event pages show live availability, so they must render per request.
export const events = defineCollection({
  type: 'page',
  source: 'events/**/*.md',
  route: '/events',
  prerender: false
})

export default defineContentConfig({
  collections: { docs, events }
})
