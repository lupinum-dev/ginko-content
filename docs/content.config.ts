import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'
import { z } from 'zod'

const Button = z.object({
  label: z.string(),
  icon: z.string().optional(),
  trailingIcon: z.string().optional(),
  to: z.string(),
  color: z.enum(['primary', 'neutral']).optional(),
  size: z.enum(['sm', 'md', 'lg', 'xl']).optional(),
  variant: z.enum(['solid', 'outline', 'subtle', 'link']).optional(),
  id: z.string().optional(),
  target: z.enum(['_blank', '_self']).optional()
})

export const landing = defineCollection({
  type: 'page',
  source: 'index.md',
  route: '/',
  agent: {
    section: 'overview',
    markdown: true
  }
})

export const docs = defineCollection({
  type: 'page',
  source: 'docs/**/*.md',
  route: '/docs',
  agent: {
    section: 'documentation',
    markdown: true
  },
  schema: z.object({
    links: z.array(Button).optional()
  }) as any
})

export default defineContentConfig({
  collections: { landing, docs },
  agent: {
    site: {
      title: 'Ginko Content documentation',
      description: 'Filesystem-first content for Nuxt sites that need coherent routes, types, localization, search, and SEO.',
      url: 'https://ginko-content.nuxt.dev',
      profile: 'https://ginko-content.nuxt.dev',
      contentSignals: {
        search: true,
        aiInput: true,
        aiTrain: true
      }
    },
    sections: [
      { id: 'overview', title: 'Overview', order: 0 },
      { id: 'documentation', title: 'Documentation', order: 10 }
    ],
    markdown: {
      metadata: {
        enabled: true,
        defaultFields: ['title', 'description', 'url', 'source']
      }
    }
  }
})
