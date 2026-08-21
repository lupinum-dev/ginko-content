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
      description: 'Fixture for disabled agent routes.',
      whenToUse: 'Use this fixture to verify that disabled agent routes stay disabled.'
    },
    pages: [
      defineAgentAppPage({
        id: 'disabled-index',
        route: '/',
        section: 'content',
        title: 'Agent Disabled Markdown',
        description: 'A route that must remain unavailable.',
        render: () => '# Agent Disabled Markdown\n\nThis route must not be served when module agent routes are disabled.'
      })
    ]
  },
  collections: { records }
})
