import { describe, expect, test } from 'vitest'

describe('collection resolver parity contracts', () => {
  test('collection sources with numeric prefixes match translated slug filenames', async () => {
    const { resolveCollection } = await import('../../packages/content/src/core/content/collection')
    const collections = {
      docs: { source: '1.docs/**/*' },
      pricing: { source: '2.pricing.yml' },
      versions: { source: '4.changelog/**/*' }
    }

    expect(resolveCollection('de/1.dokumentation/1.erste-schritte/1.index.md', collections, ['en', 'de'])).toBe('docs')
    expect(resolveCollection('de/2.preise.yml', collections, ['en', 'de'])).toBe('pricing')
    expect(resolveCollection('de/4.aenderungen/1.launch.md', collections, ['en', 'de'])).toBe('versions')
  })

  test('shared navigation resolver yields the same shape for app and server loader strategies', async () => {
    const { resolveCollectionNavigationData } = await import('../../packages/content/src/features/collections/resolve')

    const runtime = {
      locales: ['en', 'de'],
      defaultLocale: 'en',
      collections: {
        docs: {
          i18n: {
            locales: ['en', 'de'],
            defaultLocale: 'en'
          }
        }
      }
    }
    const navigation = [
      {
        title: 'Guide',
        path: '/guide',
        _locale: 'en',
        canonicalKey: 'guide',
        children: [{ title: 'Intro', path: '/guide/intro', _locale: 'en', canonicalKey: 'guide/intro' }]
      }
    ]
    const pages = [
      { title: 'Guide', path: '/guide', file: { path: '/en/guide/index.md' } },
      { title: 'Intro', path: '/guide/intro', file: { path: '/en/guide/intro.md' } }
    ]

    const appResult = await resolveCollectionNavigationData('docs', runtime, {
      activeLocale: 'en',
      loadNavigation: async () => navigation,
      loadPages: async () => pages
    })
    const serverResult = await resolveCollectionNavigationData('docs', runtime, {
      loadNavigation: async () => navigation,
      loadPages: async () => pages
    })

    expect(appResult).toEqual(serverResult)
  })
})
