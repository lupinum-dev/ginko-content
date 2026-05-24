import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createEvent, doc } from './_utils'

const getContentManifest = vi.fn()
const resolveVariant = vi.fn()

vi.mock('../../packages/content/src/storage/driver', () => ({
  contentConfig: () => ({
    defaultLocale: 'en'
  })
}))

vi.mock('../../packages/content/src/storage/manifest', () => ({
  getContentManifest,
  resolveVariant
}))

describe('ref link contracts', () => {
  beforeEach(() => {
    getContentManifest.mockReset()
    resolveVariant.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  test('withResolvedRefs resolves localized markdown refs and preserves hashes', async () => {
    getContentManifest.mockResolvedValue({
      byRef: {
        'guide/advanced': 'docs/advanced'
      }
    })
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
  })

  test('withResolvedRefs leaves non-markdown content untouched and preserves unresolved refs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    getContentManifest.mockResolvedValue({ byRef: {} })

    const { withResolvedRefs, withResolvedRefsList, withResolvedRefsQueryResponse } = await import('../../packages/content/src/storage/references')

    await expect(withResolvedRefs(createEvent(), doc({ _type: 'yaml', body: null as any }), 'de')).resolves.toMatchObject({
      _type: 'yaml'
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
    await expect(withResolvedRefsList(createEvent(), [doc(), doc({ _type: 'yaml', body: null as any })], 'de')).resolves.toHaveLength(2)

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
})
