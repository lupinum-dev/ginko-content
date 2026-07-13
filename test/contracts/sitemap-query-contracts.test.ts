import { describe, expect, test } from 'vitest'
import {
  projectSitemapEntry,
  queryCollectionsSitemapEntriesData
} from '../../packages/content/src/features/sitemap/query'

describe('sitemap query contracts', () => {
  test('projects locale ownership and reciprocal alternates for Nuxt Sitemap sources', () => {
    const variants = [
      { locale: 'en', path: '/guide/intro' },
      { locale: 'de', path: '/de/leitfaden/einfuehrung' }
    ]
    const localeToLanguage = { en: 'en-US', de: 'de-DE' }

    expect(
      variants.map(variant =>
        projectSitemapEntry({
          siteUrl: 'https://docs.example.test',
          defaultLocale: 'en',
          localeToLanguage,
          variant,
          variants
        })
      )
    ).toEqual([
      {
        _sitemap: 'en-US',
        loc: '/guide/intro',
        alternatives: [
          { hreflang: 'x-default', href: 'https://docs.example.test/guide/intro' },
          { hreflang: 'en-US', href: 'https://docs.example.test/guide/intro' },
          {
            hreflang: 'de-DE',
            href: 'https://docs.example.test/de/leitfaden/einfuehrung'
          }
        ]
      },
      {
        _sitemap: 'de-DE',
        loc: '/de/leitfaden/einfuehrung',
        alternatives: [
          { hreflang: 'x-default', href: 'https://docs.example.test/guide/intro' },
          { hreflang: 'en-US', href: 'https://docs.example.test/guide/intro' },
          {
            hreflang: 'de-DE',
            href: 'https://docs.example.test/de/leitfaden/einfuehrung'
          }
        ]
      }
    ])
  })

  test('emits non-i18n sitemap entries without requiring a locale', async () => {
    await expect(queryCollectionsSitemapEntriesData({
      collections: {
        docs: {}
      },
      runtimeSiteUrl: 'https://docs.example.test'
    }, {
      loadCollectionPages: async () => [{
        path: '/docs/intro'
      }],
      loadRouteMeta: async () => ({
        locale: '',
        path: '/docs/intro',
        defaultLocale: '',
        variants: []
      }),
      loadPage: async () => ({})
    })).resolves.toEqual([
      {
        loc: '/docs/intro'
      }
    ])
  })

  test('keeps filesystem pages when storage omits the collection marker', async () => {
    await expect(queryCollectionsSitemapEntriesData({
      collections: {
        docs: {}
      },
      defaultLocale: 'en',
      runtimeSiteUrl: 'https://docs.example.test',
      localeConfigs: [{ code: 'en', language: 'en-US' }]
    }, {
      loadCollectionPages: async () => [{
        canonicalKey: 'guide/intro',
        path: '/guide/intro',
        locale: 'en'
      }],
      loadRouteMeta: async () => ({
        locale: 'en',
        path: '/guide/intro',
        defaultLocale: 'en',
        variants: [{ locale: 'en', path: '/guide/intro' }]
      }),
      loadPage: async () => ({})
    })).resolves.toEqual([
      {
        _sitemap: 'en-US',
        loc: '/guide/intro'
      }
    ])
  })

  test('expands relative image URLs against the site URL', async () => {
    await expect(queryCollectionsSitemapEntriesData({
      collections: {
        docs: {}
      },
      defaultLocale: 'en',
      runtimeSiteUrl: 'https://docs.example.test',
      localeConfigs: [{ code: 'en', language: 'en-US' }]
    }, {
      loadCollectionPages: async () => [{
        collection: 'docs',
        canonicalKey: 'guide/intro',
        path: '/guide/intro',
        locale: 'en',
        image: {
          src: '/images/intro.png'
        }
      }],
      loadRouteMeta: async () => ({
        locale: 'en',
        path: '/guide/intro',
        defaultLocale: 'en',
        variants: [{ locale: 'en', path: '/guide/intro' }]
      }),
      loadPage: async () => ({
        body: {
          type: 'root',
          children: [{
            type: 'element',
            tag: 'img',
            props: { src: '/content/inline.png' },
            children: []
          }]
        }
      })
    })).resolves.toEqual([
      {
        _sitemap: 'en-US',
        loc: '/guide/intro',
        images: [
          { loc: 'https://docs.example.test/content/inline.png' },
          { loc: 'https://docs.example.test/images/intro.png' }
        ]
      }
    ])
  })
})
