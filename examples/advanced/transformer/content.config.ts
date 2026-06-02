import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const docs = defineCollection({ type: 'page', source: '**/*' })

export default defineContentConfig({
  collections: { docs }
})
