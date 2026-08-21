import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createTestEvent } from '../support/provider-scenarios/event'
import { doc } from '../support/content-documents'
import {
  collectMarkdownRefLinks,
  parseRefLink,
  resolveConfiguredQuickLink,
  resolveConfiguredQuickLinks,
  resolveMarkdownRenderRefs,
  rewriteMarkdownRefLinks
} from '../../packages/content/src/core/references/resolve'

const resolveVariant = vi.fn()
const getContentGraph = vi.fn()
const contentLinks = vi.hoisted(() => ({
  value: {} as Record<string, Record<string, { route: string }>>
}))

vi.mock('../../packages/content/src/storage/driver', () => ({
  contentConfig: () => ({
    defaultLocale: 'en',
    locales: ['en', 'de'],
    collections: {
      docs: {
        route: { en: '/guide', de: '/leitfaden' },
        localePolicy: {
          localized: true,
          locales: ['en', 'de'],
          defaultLocale: 'en',
          fallback: { de: ['en'] },
          translatedSlugs: false,
          routeMounts: { en: '/guide', de: '/leitfaden' }
        }
      },
      blog: {
        route: { en: '/blog', de: '/blog' },
        localePolicy: {
          localized: true,
          locales: ['en', 'de'],
          defaultLocale: 'en',
          fallback: { de: ['en'] },
          translatedSlugs: false,
          routeMounts: { en: '/blog', de: '/blog' }
        }
      }
    },
    links: contentLinks.value
  })
}))

vi.mock('../../packages/content/src/storage/graph', () => ({
  getContentGraph,
  resolveVariant
}))

const graphWithReferenceTargets = (
  targets: Record<string, { canonicalKey: string, collection: string }>
) => {
  const byCollectionCanonical: Record<string, Record<string, Record<string, unknown>>> = {}
  for (const { canonicalKey, collection } of Object.values(targets)) {
    byCollectionCanonical[collection] ||= {}
    byCollectionCanonical[collection]![canonicalKey] = {
      en: {
        canonicalKey,
        contentId: `content:${collection}:${canonicalKey}`,
        locale: 'en',
        path: `/${canonicalKey}`,
        document: { collection }
      }
    }
  }
  return {
    byCanonical: {},
    byCollectionCanonical,
    referenceTargets: new Map(Object.entries(targets))
  }
}

describe('ref link contracts', () => {
  beforeEach(() => {
    resolveVariant.mockReset()
    getContentGraph.mockReset()
    getContentGraph.mockResolvedValue(graphWithReferenceTargets({}))
    contentLinks.value = {}
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('withResolvedRefs resolves localized markdown refs and preserves hashes', async () => {
    getContentGraph.mockResolvedValue(graphWithReferenceTargets({
      'guide/advanced': { canonicalKey: 'docs/advanced', collection: 'docs' }
    }))
    resolveVariant.mockResolvedValue({
      canonicalKey: 'docs/advanced',
      contentId: 'content:docs:advanced',
      resolvedLocale: 'de',
      path: '/fortgeschritten',
      fallback: false
    })

    const { withResolvedRefs } = await import('../../packages/content/src/storage/references')
    const content = doc({
      body: {
        type: 'root',
        children: [
          {
            type: 'element',
            tag: 'a',
            props: { href: '$guide/advanced#deep-dive' },
            children: []
          }
        ]
      }
    })

    await expect(withResolvedRefs(createTestEvent(), content, 'de')).resolves.toMatchObject({
      resolved: {
        resolvedRefs: {
          '$guide/advanced#deep-dive': '/de/leitfaden/fortgeschritten#deep-dive'
        }
      }
    })
  })

  test('withResolvedRefs resolves authored ids, canonical keys, and path aliases through one scoped resolver', async () => {
    getContentGraph.mockResolvedValue(graphWithReferenceTargets({
      'stable-page-id': { canonicalKey: 'docs/stable-page', collection: 'docs' },
      'guide/advanced': { canonicalKey: 'docs/advanced', collection: 'docs' },
      'de/leitfaden/einstieg': { canonicalKey: 'docs/getting-started', collection: 'docs' }
    }))
    resolveVariant.mockImplementation(async (_event, canonicalKey: string, locale?: string) => {
      const paths: Record<string, string> = {
        'docs/stable-page': '/stabile-seite',
        'docs/advanced': '/advanced',
        'docs/getting-started': '/einstieg'
      }

      return {
        canonicalKey,
        contentId: `content:${canonicalKey}`,
        locale: locale || 'en',
        requestedLocale: locale,
        resolvedLocale: locale || 'en',
        fallback: false,
        availableLocales: [locale || 'en'],
        path: paths[canonicalKey]
      }
    })

    const { withResolvedRefs } = await import('../../packages/content/src/storage/references')
    const event = createTestEvent()
    const resolved = await withResolvedRefs(event, doc({
      body: {
        type: 'root',
        children: [
          { type: 'element', tag: 'a', props: { href: '$stable-page-id' }, children: [] },
          { type: 'element', tag: 'a', props: { href: '$guide/advanced#deep-dive' }, children: [] },
          { type: 'element', tag: 'a', props: { href: '$de/leitfaden/einstieg' }, children: [] }
        ]
      }
    }), 'de')

    expect((resolved as any).resolved?.resolvedRefs).toEqual({
      '$stable-page-id': '/de/leitfaden/stabile-seite',
      '$guide/advanced#deep-dive': '/de/leitfaden/advanced#deep-dive',
      '$de/leitfaden/einstieg': '/de/leitfaden/einstieg'
    })
  })

  test('withResolvedRefs keeps the collection selected by a unique alias when canonical keys overlap', async () => {
    getContentGraph.mockResolvedValue(graphWithReferenceTargets({
      'docs/getting-started': { canonicalKey: '1', collection: 'docs' }
    }))
    resolveVariant.mockResolvedValue({
      canonicalKey: '1',
      contentId: 'content:docs:getting-started',
      locale: 'en',
      resolvedLocale: 'en',
      fallback: false,
      availableLocales: ['en'],
      path: '/getting-started'
    })

    const { withResolvedRefs } = await import('../../packages/content/src/storage/references')
    const event = createTestEvent()
    const resolved = await withResolvedRefs(event, doc({
      body: {
        type: 'root',
        children: [
          {
            type: 'element',
            tag: 'a',
            props: { href: '$docs/getting-started' },
            children: []
          }
        ]
      }
    }), 'en')

    expect(resolveVariant).toHaveBeenCalledWith(event, '1', 'en', {
      collection: 'docs'
    })
    expect((resolved as any).resolved?.resolvedRefs).toEqual({
      '$docs/getting-started': '/guide/getting-started'
    })
  })

  test('withResolvedRefs resolves markdown refs through locale fallback', async () => {
    getContentGraph.mockResolvedValue(graphWithReferenceTargets({
      'guide/advanced': { canonicalKey: 'docs/advanced', collection: 'docs' }
    }))
    resolveVariant.mockResolvedValue({
      canonicalKey: 'docs/advanced',
      contentId: 'content:docs:advanced',
      resolvedLocale: 'en',
      path: '/advanced',
      fallback: true
    })

    const { withResolvedRefs } = await import('../../packages/content/src/storage/references')
    await expect(withResolvedRefs(createTestEvent(), doc({
      file: { path: '/de/guide/missing-translation.md' },
      body: {
        type: 'root',
        children: [
          {
            type: 'element',
            tag: 'a',
            props: { href: '$guide/advanced#deep-dive' },
            children: []
          }
        ]
      }
    }), 'de')).resolves.toMatchObject({
      resolved: {
        resolvedRefs: {
          '$guide/advanced#deep-dive': '/de/leitfaden/advanced#deep-dive'
        }
      }
    })
  })

  test('withResolvedRefs leaves non-markdown content untouched and preserves unresolved refs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { withResolvedRefs, withResolvedRefsList } = await import('../../packages/content/src/storage/references')

    await expect(withResolvedRefs(createTestEvent(), doc({ type: 'yaml', body: null as any }), 'de')).resolves.toMatchObject({
      type: 'yaml'
    })

    const unresolved = await withResolvedRefs(createTestEvent(), doc({
      body: {
        type: 'root',
        children: [
          {
            type: 'element',
            tag: 'a',
            props: { href: '$missing/ref' },
            children: []
          }
        ]
      }
    }), 'de')

    expect((unresolved as any).resolved?.resolvedRefs).toEqual({
      '$missing/ref': '$missing/ref'
    })
    await expect(withResolvedRefsList(createTestEvent(), [doc(), doc({ type: 'yaml', body: null as any })], 'de')).resolves.toHaveLength(2)

    expect((unresolved as any).resolved?.resolvedRefs).toBeTruthy()
  })

  test('withResolvedRefs preserves configured quick links without unresolved-ref warnings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    contentLinks.value = {
      main: {
        services: { route: 'services' }
      }
    }

    const { withResolvedRefs } = await import('../../packages/content/src/storage/references')
    const resolved = await withResolvedRefs(createTestEvent(), doc({
      body: {
        type: 'root',
        children: [
          {
            type: 'element',
            tag: 'card',
            props: { to: '$main.services#plans' },
            children: []
          }
        ]
      }
    }), 'de')

    expect((resolved as any).resolved?.resolvedRefs).toEqual({
      '$main.services#plans': '$main.services#plans'
    })
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Could not resolve markdown ref "$main.services#plans"'))
    warn.mockRestore()
  })

  test('withResolvedRefs lets content refs win over configured quick-link aliases', async () => {
    contentLinks.value = {
      main: {
        services: { route: 'services' }
      }
    }
    getContentGraph.mockResolvedValue(graphWithReferenceTargets({
      'main.services': { canonicalKey: 'docs/services', collection: 'docs' }
    }))
    resolveVariant.mockResolvedValue({
      canonicalKey: 'docs/services',
      contentId: 'content:docs:services',
      resolvedLocale: 'de',
      path: '/services',
      fallback: false
    })

    const { withResolvedRefs } = await import('../../packages/content/src/storage/references')
    const resolved = await withResolvedRefs(createTestEvent(), doc({
      body: {
        type: 'root',
        children: [
          {
            type: 'element',
            tag: 'a',
            props: { href: '$main.services#plans' },
            children: []
          }
        ]
      }
    }), 'de')

    expect((resolved as any).resolved?.resolvedRefs).toEqual({
      '$main.services#plans': '/de/leitfaden/services#plans'
    })
  })

  test('parses markdown ref links with optional hash fragments', () => {
    expect(parseRefLink('$guide-advanced')).toEqual({
      ref: 'guide-advanced',
      hash: ''
    })
    expect(parseRefLink('$docs.getting-started')).toEqual({
      ref: 'docs.getting-started',
      hash: ''
    })
    expect(parseRefLink('$guide-advanced#deep-dive')).toEqual({
      ref: 'guide-advanced',
      hash: '#deep-dive'
    })
    expect(parseRefLink('/guide/advanced')).toBeNull()
    expect(parseRefLink('ref:guide-advanced')).toBeNull()
    expect(parseRefLink('$#hash-only')).toBeNull()
  })

  test('collects and rewrites markdown ref links without mutating the original body', () => {
    const body = {
      type: 'root',
      children: [
        {
          type: 'element',
          tag: 'p',
          props: {},
          children: [
            {
              type: 'element',
              tag: 'a',
              props: {
                href: '$guide-advanced#deep-dive'
              },
              children: [
                {
                  type: 'text',
                  value: 'Advanced'
                }
              ]
            },
            {
              type: 'element',
              tag: 'card',
              props: {
                to: '$docs.getting-started'
              },
              children: []
            },
            {
              type: 'element',
              tag: 'a',
              props: {
                href: '$main.pricing'
              },
              children: []
            },
            {
              type: 'element',
              tag: 'read-more',
              props: {
                links: [{ title: 'Nested', to: '$docs.nested' }]
              },
              children: []
            }
          ]
        }
      ]
    }

    expect(collectMarkdownRefLinks(body)).toEqual([
      '$guide-advanced#deep-dive',
      '$docs.getting-started',
      '$main.pricing',
      '$docs.nested'
    ])

    const rewritten = rewriteMarkdownRefLinks(body, {
      '$guide-advanced#deep-dive': '/guide/advanced#deep-dive',
      '$docs.getting-started': '/de/docs/einstieg',
      '$main.pricing': '/de/pricing',
      '$docs.nested': '/de/docs/nested'
    })

    expect(rewritten.children[0].children[0].props.href).toBe('/guide/advanced#deep-dive')
    expect(rewritten.children[0].children[1].props.to).toBe('/de/docs/einstieg')
    expect(rewritten.children[0].children[2].props.href).toBe('/de/pricing')
    expect(rewritten.children[0].children[3].props.links[0].to).toBe('/de/docs/nested')
    expect(body.children[0].children[0].props.href).toBe('$guide-advanced#deep-dive')
    expect(body.children[0].children[1].props.to).toBe('$docs.getting-started')
    expect(body.children[0].children[3].props.links[0].to).toBe('$docs.nested')
  })

  test('resolves configured markdown quick links to route names with hashes', () => {
    const links = {
      main: {
        pricing: { route: 'pricing' },
        account: {
          route: 'account-section',
          params: { section: 'billing' },
          query: { upgrade: true, empty: undefined }
        }
      }
    }

    expect(resolveConfiguredQuickLink('$main.pricing#plans', links, route => `/de/${route.name}${route.hash || ''}`)).toBe('/de/pricing#plans')
    expect(resolveConfiguredQuickLink('$main.account', links, route => {
      expect(route).toEqual({
        name: 'account-section',
        params: { section: 'billing' },
        query: { upgrade: true, empty: undefined }
      })
      return '/de/account/billing?upgrade=true'
    })).toBe('/de/account/billing?upgrade=true')
    expect(resolveConfiguredQuickLinks(['$main.pricing', '$docs.getting-started'], links, route => `/${route.name}`)).toEqual({
      '$main.pricing': '/pricing'
    })
    expect(resolveConfiguredQuickLink('$main', links, route => `/${route.name}`)).toBeUndefined()
    expect(resolveConfiguredQuickLink('/pricing', links, route => `/${route.name}`)).toBeUndefined()
  })

  test('combines render-time quick links with concrete content refs', () => {
    const body = {
      type: 'root',
      children: [
        { type: 'element', tag: 'a', props: { href: '$main.pricing#plans' }, children: [] },
        { type: 'element', tag: 'card', props: { to: '$docs.getting-started' }, children: [] }
      ]
    }

    expect(resolveMarkdownRenderRefs(
      body,
      {
        '$main.pricing#plans': '$main.pricing#plans',
        '$docs.getting-started': '/de/docs/einstieg'
      },
      {
        main: {
          pricing: { route: 'pricing' }
        }
      },
      route => `/de/${route.name}${route.hash || ''}`
    )).toEqual({
      '$main.pricing#plans': '/de/pricing#plans',
      '$docs.getting-started': '/de/docs/einstieg'
    })
  })

})
