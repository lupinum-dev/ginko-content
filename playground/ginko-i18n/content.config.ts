import { defineAgentAppPage, defineAgentSection, defineCollection, defineContentConfig, reference } from '@lupinum/ginko-content/config'
import { z } from 'zod'

export const docs = defineCollection({
  type: 'page',
  source: '*/1.*/*.md',
  i18n: true,
  route: {
    en: '/guide',
    de: '/leitfaden'
  },
  agent: { section: 'docs', markdown: true },
  strict: true,
  schema: z.object({
    title: z.string(),
    related: reference('docs').optional()
  })
})

export const authors = defineCollection({
  type: 'data',
  source: 'authors/*.yml',
  i18n: true,
  strict: true,
  schema: z.object({
    name: z.string(),
    role: z.string().optional(),
    profile: z.object({
      focus: z.string(),
      localeLabel: z.string()
    })
  })
})

export default defineContentConfig({
  agent: {
    site: {
      title: {
        en: 'Ginko Content Playground',
        de: 'Ginko Content Spielplatz'
      },
      description: {
        en: 'Generated output fixture for localized Ginko content.',
        de: 'Generierte Ausgabe fuer lokalisierte Ginko Inhalte.'
      },
      url: 'https://ginko-content.example.test',
      defaultLocale: 'en',
      locales: ['en', 'de']
    },
    sections: [
      defineAgentSection({
        id: 'docs',
        title: {
          en: 'Documentation',
          de: 'Dokumentation'
        },
        order: 10
      }),
      defineAgentSection({
        id: 'app',
        title: {
          en: 'App Pages',
          de: 'App-Seiten'
        },
        order: 20
      })
    ],
    pages: [
      defineAgentAppPage({
        id: 'contact',
        route: {
          en: '/contact',
          de: '/de/kontakt'
        },
        section: 'app',
        title: {
          en: 'Contact',
          de: 'Kontakt'
        },
        description: {
          en: 'Contact page exported as agent markdown.',
          de: 'Kontaktseite als Agent-Markdown.'
        },
        render: ({ locale }) => locale === 'de'
          ? '# Kontakt\n\nDiese App-Seite prueft lokalisierte Agent-Ausgabe.'
          : '# Contact\n\nThis app page verifies localized agent output.'
      })
    ]
  },
  collections: { docs, authors }
})
