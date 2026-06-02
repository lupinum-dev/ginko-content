import { describe, expect, test } from 'vitest'
import { validateContentPageRouteMetadata } from '../../packages/content/src/module/route-meta-validation'

describe('route metadata validation contracts', () => {
  test('accepts page metadata that matches localized collection route mounts', () => {
    expect(() => validateContentPageRouteMetadata(
      [{
        file: '/app/pages/docs/[...slug].vue',
        meta: {
          content: {
            collection: 'docs',
            route: { en: '/docs', de: '/dokumentation' }
          }
        }
      }],
      {
        docs: {
          type: 'page',
          route: { en: '/docs', de: '/dokumentation' },
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] }
        }
      },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )).not.toThrow()
  })

  test('reports route mismatches with collection, locale, expected route, and page file', () => {
    expect(() => validateContentPageRouteMetadata(
      [{
        file: '/app/pages/docs/[...slug].vue',
        meta: {
          content: {
            collection: 'docs',
            route: { en: '/docs', de: '/docs' }
          }
        }
      }],
      {
        docs: {
          type: 'page',
          route: { en: '/docs', de: '/dokumentation' },
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] }
        }
      },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )).toThrow(
      '@lupinum/ginko-content route metadata mismatch in "/app/pages/docs/[...slug].vue": collection "docs" locale "de" expected route "/dokumentation" but page metadata declares "/docs".'
    )
  })

  test('reports missing localized routes from page metadata', () => {
    expect(() => validateContentPageRouteMetadata(
      [{
        file: '/app/pages/docs/[...slug].vue',
        meta: {
          content: {
            collection: 'docs',
            route: { en: '/docs' }
          }
        }
      }],
      {
        docs: {
          type: 'page',
          route: { en: '/docs', de: '/dokumentation' },
          i18n: { defaultLocale: 'en', locales: ['en', 'de'] }
        }
      },
      { locales: ['en', 'de'], defaultLocale: 'en' }
    )).toThrow(
      '@lupinum/ginko-content route metadata mismatch in "/app/pages/docs/[...slug].vue": collection "docs" is missing locale "de" route "/dokumentation".'
    )
  })

  test('validates nested Nuxt page children', () => {
    expect(() => validateContentPageRouteMetadata(
      [{
        file: '/app/pages/docs.vue',
        children: [{
          file: '/app/pages/docs/[...slug].vue',
          meta: {
            content: {
              collection: 'docs',
              route: '/docs'
            }
          }
        }]
      }],
      {
        docs: {
          type: 'page',
          route: '/docs'
        }
      },
      { locales: ['en'], defaultLocale: 'en' }
    )).not.toThrow()
  })
})
