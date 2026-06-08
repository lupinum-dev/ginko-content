import { defineAgentAppPage, defineAgentMetadataFields, defineAgentSection, defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'
import { z } from 'zod'

const metadataFields = defineAgentMetadataFields(['title', 'description', 'url', 'route', 'locale', 'section', 'collection', 'source'])

export const docs = defineCollection({
  type: 'page',
  source: '*/1.*/*.md',
  i18n: true,
  route: {
    en: '/docs',
    de: '/dokumentation'
  },
  agent: {
    section: 'docs',
    markdown: {
      metadata: metadataFields
    }
  },
  strict: true,
  schema: z.object({
    title: z.string(),
    description: z.string().optional()
  })
})

export const services = defineCollection({
  type: 'page',
  source: '*/2.*/*.md',
  i18n: true,
  route: {
    en: '/services',
    de: '/leistungen'
  },
  agent: {
    section: 'services',
    markdown: true
  },
  strict: true,
  schema: z.object({
    title: z.string(),
    description: z.string().optional()
  })
})

export const records = defineCollection({
  type: 'data',
  source: 'records/*.yml',
  strict: true,
  schema: z.object({
    title: z.string(),
    secret: z.string()
  })
})

export default defineContentConfig({
  agent: {
    site: {
      title: {
        en: 'Agent Output Fixture',
        de: 'Agent-Ausgabe Fixture'
      },
      description: {
        en: 'Small fixture for custom agent markdown serializers.',
        de: 'Kleine Fixture fuer eigene Agent-Markdown-Serializer.'
      },
      url: 'https://agent-output.example.test',
      defaultLocale: 'en',
      locales: ['en', 'de'],
      profile: 'documentation',
      contentSignals: {
        search: true,
        aiInput: true,
        aiTrain: false
      }
    },
    markdown: {
      metadata: {
        enabled: true,
        defaultFields: metadataFields
      }
    },
    sections: [
      defineAgentSection({ id: 'docs', title: { en: 'Docs', de: 'Dokumentation' }, order: 10 }),
      defineAgentSection({ id: 'services', title: { en: 'Services', de: 'Leistungen' }, order: 20 }),
      defineAgentSection({ id: 'legal', title: { en: 'Legal', de: 'Rechtliches' }, order: 90 })
    ],
    pages: [
      defineAgentAppPage({
        id: 'legal-notice',
        route: {
          en: '/legal',
          de: '/de/rechtliches'
        },
        section: 'legal',
        title: {
          en: 'Legal Notice',
          de: 'Impressum'
        },
        description: {
          en: 'App-owned legal page.',
          de: 'App-eigene rechtliche Seite.'
        },
        metadata: metadataFields,
        render: ({ locale }) => locale === 'de'
          ? '# Impressum\n\nBetreiber: Agent Output GmbH\n\nKontakt: legal@example.test'
          : '# Legal Notice\n\nOperator: Agent Output GmbH\n\nContact: legal@example.test'
      })
    ]
  },
  collections: { docs, services, records }
})
