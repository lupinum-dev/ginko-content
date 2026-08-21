import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const docs = defineCollection({
  type: 'page',
  source: 'guide/**/*.md',
  route: '/docs',
  agent: { section: 'docs', markdown: true }
})

export default defineContentConfig({
  collections: { docs },
  agent: {
    sections: [{ id: 'docs', title: 'Docs' }],
    site: {
      title: 'Ginko Agent Example',
      description: 'A minimal site exposing markdown to agents.',
      url: 'https://example.com'
    }
  }
})
