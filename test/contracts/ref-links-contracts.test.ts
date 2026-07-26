import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEvent, doc } from './_utils'
import {
  collectMarkdownRefLinks,
  parseRefLink,
  resolveConfiguredQuickLink,
  resolveConfiguredQuickLinks,
  resolveMarkdownRenderRefs,
  rewriteMarkdownRefLinks
} from '../../packages/content/src/core/references/resolve'

const resolveCanonicalKey = vi.fn()
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
      }
    },
    links: contentLinks.value
  })
}))

vi.mock('../../packages/content/src/storage/graph', () => ({
  getContentGraph,
  resolveCanonicalKey,
  resolveVariant
}))

describe('ref link contracts', () => {
  beforeEach(() => {
    resolveCanonicalKey.mockReset()
    resolveVariant.mockReset()
    getContentGraph.mockReset()
    getContentGraph.mockResolvedValue({
      byId: new Proxy({}, {
        get: () => ({ collection: 'docs' })
      })
    })
    contentLinks.value = {}
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('withResolvedRefs resolves localized markdown refs and preserves hashes', async () => {
    resolveCanonicalKey.mockResolvedValue('docs/advanced')
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

    await expect(withResolvedRefs(createEvent(), content, 'de')).resolves.toMatchObject({
      resolved: {
        resolvedRefs: {
          '$guide/advanced#deep-dive': '/de/leitfaden/fortgeschritten#deep-dive'
        }
      }
    })
    expect(resolveCanonicalKey).toHaveBeenCalledWith(createEvent(), 'guide/advanced')
  })

  test('withResolvedRefs resolves authored ids, canonical keys, and path aliases through one canonical resolver', async () => {
    resolveCanonicalKey.mockImplementation(async (_event, identity: string) => ({
      'stable-page-id': 'docs/stable-page',
      'guide/advanced': 'docs/advanced',
      'de/leitfaden/einstieg': 'docs/getting-started'
    })[identity] || null)
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
    const resolved = await withResolvedRefs(createEvent(), doc({
      body: {
        type: 'root',
        children: [
          { type: 'element', tag: 'a', props: { href: '$stable-page-id' }, children: [] },
          { type: 'element', tag: 'a', props: { href: '$guide/advanced#deep-dive' }, children: [] },
          { type: 'element', tag: 'a', props: { href: '$de/leitfaden/einstieg' }, children: [] }
        ]
      }
    }), 'de')

    expect(resolveCanonicalKey.mock.calls.map(call => call[1])).toEqual([
      'stable-page-id',
      'guide/advanced',
      'de/leitfaden/einstieg'
    ])
    expect((resolved as any).resolved?.resolvedRefs).toEqual({
      '$stable-page-id': '/de/leitfaden/stabile-seite',
      '$guide/advanced#deep-dive': '/de/leitfaden/advanced#deep-dive',
      '$de/leitfaden/einstieg': '/de/leitfaden/einstieg'
    })
  })

  test('withResolvedRefs resolves markdown refs through locale fallback', async () => {
    resolveCanonicalKey.mockResolvedValue('docs/advanced')
    resolveVariant.mockResolvedValue({
      canonicalKey: 'docs/advanced',
      contentId: 'content:docs:advanced',
      resolvedLocale: 'en',
      path: '/advanced',
      fallback: true
    })
    getContentGraph.mockResolvedValue({
      byId: {
        'content:docs:advanced': { collection: 'docs' }
      }
    })

    const { withResolvedRefs } = await import('../../packages/content/src/storage/references')
    await expect(withResolvedRefs(createEvent(), doc({
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
    resolveCanonicalKey.mockResolvedValue(null)

    const { withResolvedRefs, withResolvedRefsList, withResolvedRefsQueryResponse } = await import('../../packages/content/src/storage/references')

    await expect(withResolvedRefs(createEvent(), doc({ type: 'yaml', body: null as any }), 'de')).resolves.toMatchObject({
      type: 'yaml'
    })

    const unresolved = await withResolvedRefs(createEvent(), doc({
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
    await expect(withResolvedRefsList(createEvent(), [doc(), doc({ type: 'yaml', body: null as any })], 'de')).resolves.toHaveLength(2)

    const firstResponse = await withResolvedRefsQueryResponse(createEvent(), {
      result: doc({
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
      })
    } as any, {
      first: true,
      resolveLocale: { locale: 'de' }
    } as any)
    expect((firstResponse.result as any).resolved?.resolvedRefs).toBeTruthy()
  })

  test('withResolvedRefs preserves configured quick links without unresolved-ref warnings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    contentLinks.value = {
      main: {
        services: { route: 'services' }
      }
    }
    resolveCanonicalKey.mockResolvedValue(null)

    const { withResolvedRefs } = await import('../../packages/content/src/storage/references')
    const resolved = await withResolvedRefs(createEvent(), doc({
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
    expect(resolveCanonicalKey).toHaveBeenCalledWith(createEvent(), 'main.services')
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Could not resolve markdown ref "$main.services#plans"'))
    warn.mockRestore()
  })

  test('withResolvedRefs lets content refs win over configured quick-link aliases', async () => {
    contentLinks.value = {
      main: {
        services: { route: 'services' }
      }
    }
    resolveCanonicalKey.mockResolvedValue('docs/services')
    resolveVariant.mockResolvedValue({
      canonicalKey: 'docs/services',
      contentId: 'content:docs:services',
      resolvedLocale: 'de',
      path: '/services',
      fallback: false
    })

    const { withResolvedRefs } = await import('../../packages/content/src/storage/references')
    const resolved = await withResolvedRefs(createEvent(), doc({
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

    expect(resolveCanonicalKey).toHaveBeenCalledWith(createEvent(), 'main.services')
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
