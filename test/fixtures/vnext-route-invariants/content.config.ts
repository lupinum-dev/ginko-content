import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

// Route-mounted page collection: two locales (en default, de), mounted under
// locale-specific route prefixes so translated numeric slugs resolve
// correctly (VNEXT 20.1).
export const docs = defineCollection({
  type: 'page',
  source: '*/1.*/**/*.md',
  i18n: true,
  route: {
    en: '/guide',
    de: '/leitfaden'
  }
})

// Data collection: never route-mounted -- proves "structural non-routes
// never appear" alongside partials/navigation-control files/drafts.
export const notes = defineCollection({
  type: 'data',
  source: 'notes/*.yml',
  i18n: true
})

export default defineContentConfig({
  collections: { docs, notes }
})
