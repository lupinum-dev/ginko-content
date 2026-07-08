import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEvent, doc } from './_utils'

const resolveCanonicalKey = vi.fn()
const resolveVariant = vi.fn()
const contentLinks = vi.hoisted(() => ({
  value: {} as Record<string, Record<string, { route: string }>>
}))

vi.mock('../../packages/content/src/storage/driver', () => ({
  contentConfig: () => ({
    defaultLocale: 'en',
    links: contentLinks.value
  })
}))

vi.mock('../../packages/content/src/storage/manifest', () => ({
  resolveCanonicalKey,
  resolveVariant
}))

describe('ref link contracts', () => {
  beforeEach(() => {
    resolveCanonicalKey.mockReset()
    resolveVariant.mockReset()
    contentLinks.value = {}
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('withResolvedRefs resolves localized markdown refs and preserves hashes', async () => {
    resolveCanonicalKey.mockResolvedValue('docs/advanced')
    resolveVariant.mockResolvedValue({
      canonicalKey: 'docs/advanced',
      resolvedLocale: 'de',
      path: '/leitfaden/fortgeschritten',
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
      _resolvedRefs: {
        '$guide/advanced#deep-dive': '/de/leitfaden/fortgeschritten#deep-dive'
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
        'docs/advanced': '/guide/advanced',
        'docs/getting-started': '/leitfaden/einstieg'
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
    expect((resolved as any)._resolvedRefs).toEqual({
      '$stable-page-id': '/de/stabile-seite',
      '$guide/advanced#deep-dive': '/de/guide/advanced#deep-dive',
      '$de/leitfaden/einstieg': '/de/leitfaden/einstieg'
    })
  })

  test('withResolvedRefs resolves markdown refs through locale fallback', async () => {
    resolveCanonicalKey.mockResolvedValue('docs/advanced')
    resolveVariant.mockResolvedValue({
      canonicalKey: 'docs/advanced',
      resolvedLocale: 'en',
      path: '/guide/advanced',
      fallback: true
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
      _resolvedRefs: {
        '$guide/advanced#deep-dive': '/de/guide/advanced#deep-dive'
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

    expect((unresolved as any)._resolvedRefs).toEqual({
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
    expect((firstResponse.result as any)._resolvedRefs).toBeTruthy()
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

    expect((resolved as any)._resolvedRefs).toEqual({
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
    expect((resolved as any)._resolvedRefs).toEqual({
      '$main.services#plans': '/de/services#plans'
    })
  })
})
