import { describe, expect, it } from 'vitest'

import {
  buildResolvedContentContract,
  canonicalJsonBytes,
  hashCanonicalJson,
  assertResolvedContentContract,
  sha256Hex,
} from '../../packages/content/src/cms-contract'

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

describe('resolved content contract v1', () => {
  it('emits the one closed portable contract without CMS presentation policy', () => {
    const contract = buildResolvedContentContract(
      {
        collections: {
          docs: {
            type: 'page',
            source: 'content/docs/**/*.md',
            i18n: true,
            route: { en: '/docs', de: '/dokumentation' },
            cms: {
              label: 'Documentation',
              icon: 'book',
              type: 'tree',
              settings: { workflow: 'review' },
              fields: {
                title: { editor: { width: 'half' } },
              },
            },
          },
        },
      },
      {
        defaultLocale: 'en',
        locales: ['en', 'de'],
        localeFallbacks: { de: ['en'] },
      },
    )

    expect(contract).toEqual({
      format: 'ginko-content-contract',
      version: 1,
      defaultLocale: 'en',
      locales: ['en', 'de'],
      localeFallbacks: { en: [], de: ['en'] },
      collections: {
        docs: {
          id: 'docs',
          kind: 'page',
          structure: 'tree',
          defaultLocale: 'en',
          locales: ['en', 'de'],
          routing: {
            mode: 'route',
            pathPrefix: '/docs',
            localizedPathPrefixes: { en: '/docs', de: '/dokumentation' },
            localizedSingletonPaths: null,
            slugMode: 'shared',
            rootSlug: null,
            singleton: false,
            allowMultipleRoots: false,
          },
          fields: [
            expect.objectContaining({ key: 'title', role: 'title', localized: true }),
            expect.objectContaining({ key: 'description', role: 'description', localized: true }),
            expect.objectContaining({ key: 'bodyMdc', role: 'body', type: 'richtext', localized: true }),
          ],
          portable: { format: 'mdc', bodyField: 'bodyMdc' },
          componentPolicy: { components: {} },
        },
      },
    })
    expect(JSON.stringify(contract)).not.toMatch(/Documentation|book|workflow|width/)
  })

  it('validates embedded component media policy', () => {
    expect(() => buildResolvedContentContract({ collections: {} }, {
      defaultLocale: 'en',
      locales: ['en'],
      componentPolicy: {
        components: {
          Gallery: {
            kind: 'block',
            props: { source: { type: 'string', required: true } },
            slots: ['default'],
            media: { sourceProp: 'source', altProp: null, titleProp: null, filenameProp: null },
          },
        },
      },
    })).toThrow(/asset prop/)
  })

  it('rejects malformed resolved artifacts and cyclic fallback chains', () => {
    const contract = buildResolvedContentContract({ collections: {} }, {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      localeFallbacks: { de: ['en'] },
    })

    expect(assertResolvedContentContract(contract)).toBe(contract)
    expect(() => assertResolvedContentContract({ ...contract, extra: true })).toThrow(/unknown key/i)
    expect(() => assertResolvedContentContract({
      ...contract,
      localeFallbacks: { en: ['de'], de: ['en'] },
    })).toThrow(/cycle/i)
    expect(() => assertResolvedContentContract({
      ...contract,
      collections: { broken: { id: 'broken' } },
    })).toThrow(/collection/i)
  })
})

describe('RFC 8785 canonical JSON and incremental SHA-256', () => {
  it('uses ECMAScript number spelling, UTF-16 key order, and canonical -0', () => {
    expect(text(canonicalJsonBytes({
      numbers: [JSON.parse('333333333.33333329'), 1e21, 1e30, 4.50, 2e-3, 1e-27, -0],
      nested: { b: null, a: true },
    }))).toBe('{"nested":{"a":true,"b":null},"numbers":[333333333.3333333,1e+21,1e+30,4.5,0.002,1e-27,0]}')
  })

  it('matches SHA-256 for contiguous and streamed bytes', async () => {
    const bytes = new TextEncoder().encode('abc')
    expect(await sha256Hex(bytes)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex((async function* () {
      yield bytes.slice(0, 1)
      yield bytes.slice(1)
    })())).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await sha256Hex(new TextEncoder().encode('a'.repeat(64)))).toBe('ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb')
    expect(await hashCanonicalJson({ b: 2, a: 1 })).toBe('43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777')
  })

  it.each([
    ['undefined', undefined],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['non-finite number', Number.POSITIVE_INFINITY],
    ['lone surrogate', '\uD800'],
    ['array hole', Array(1)],
    ['date', new Date(0)],
  ])('rejects %s', (_label, value) => {
    expect(() => canonicalJsonBytes(value as never)).toThrow()
  })
})
