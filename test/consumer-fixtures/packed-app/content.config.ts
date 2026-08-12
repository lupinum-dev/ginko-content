import { defineAgentSection, defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

      export const pages = defineCollection({
        type: 'page',
        source: '*.md',
        agent: {
          section: 'docs',
          markdown: true
        }
      })

      export default defineContentConfig({
        provider: 'memory',
        providers: {
          memory: '~/server/providers/memory'
        },
        agent: {
          site: {
            title: 'Packed Consumer',
            description: 'Packed package consumer smoke app.',
            url: 'https://packed-consumer.example.test',
            defaultLocale: 'en',
            locales: ['en']
          },
          sections: [
            defineAgentSection({ id: 'docs', title: 'Docs', order: 10 })
          ]
        },
        collections: { pages }
      })
    
