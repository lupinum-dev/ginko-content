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

export const landing = defineCollection('landing', {
  type: 'page',
  source: 'index.md',
  route: '/'
})

export const docs = defineCollection('docs', {
  type: 'page',
  source: 'docs/**/*.md',
  route: '/docs',
  schema: z.object({
    links: z.array(Button).optional()
  }) as any
})

export default defineContentConfig({
  collections: { landing, docs }
})
