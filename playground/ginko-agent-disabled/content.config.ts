import { defineAgentAppPage, defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'
import { z } from 'zod'

export const records = defineCollection({
  type: 'data',
  source: 'records/*.yml',
  strict: true,
  schema: z.object({
    title: z.string()
  })
})

export default defineContentConfig({
  agent: {
    site: {
      title: 'Agent Disabled Fixture',
      url: 'https://agent-disabled.example.test'
    },
    pages: [
      defineAgentAppPage({
        id: 'disabled-index',
        route: '/',
        title: 'Agent Disabled Markdown',
        render: () => '# Agent Disabled Markdown\n\nThis route must not be served when module agent routes are disabled.'
      })
    ]
  },
  collections: { records }
})
