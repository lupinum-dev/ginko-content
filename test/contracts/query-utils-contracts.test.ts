import { describe, expect, test, vi } from 'vitest'

vi.mock('h3', async () => {
  const actual = await vi.importActual<any>('h3')
  return {
    ...actual,
    getQuery: (event: any) => event._query || {},
    createError: ({ statusCode, message }: any) => {
      const error: any = new Error(message)
      error.statusCode = statusCode
      return error
    }
  }
})

describe('query transport contracts', () => {
  test('encoded HTTP params never interpret string operands as executable regex', async () => {
    const { encodeQueryParams, getContentQuery } = await import('../../packages/content/src/runtime/utils/query')
    const regexLikeString = '--REGEX /^\\/guide\\/.+/i'

    const params = {
      where: [
        { path: regexLikeString },
        { draft: { $ne: true } }
      ],
      only: ['title', 'path'],
      without: ['body'],
      sort: [{ 'file.stem': 1, $numeric: true }],
      limit: 10
    } as any

    const encoded = encodeQueryParams(params)
    expect(encoded).toContain('/')

    const decoded = getContentQuery({
      context: { params: { params: `docs/${encoded}.json` } }
    } as any) as any
    expect(decoded.where[0]!.path).toBe(regexLikeString)
    expect(decoded.where[0]!.path).not.toBeInstanceOf(RegExp)
    expect(decoded.only).toEqual(['title', 'path'])
  })

  test('encode/decodeQueryParams round-trip Unicode without Buffer', async () => {
    vi.stubGlobal('Buffer', undefined)

    try {
      const { encodeQueryParams, decodeQueryParams } = await import('../../packages/content/src/runtime/utils/query')
      const params = {
        where: [{ title: 'Über 日本語' }]
      } as any

      expect(decodeQueryParams(encodeQueryParams(params))).toEqual(params)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('decodeQueryParams rejects malformed UTF-8 instead of replacement-decoding it', async () => {
    const { decodeQueryParams } = await import('../../packages/content/src/runtime/utils/query')
    const bytes = [0x7B, 0x22, 0x78, 0x22, 0x3A, 0x22, 0xFF, 0x22, 0x7D]
    const encoded = btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    expect(() => decodeQueryParams(encoded)).toThrow()
  })

  test('encodeQueryParams rejects values JSON transport would coerce or drop', async () => {
    const { encodeQueryParams } = await import('../../packages/content/src/runtime/utils/query')
    const circular: Record<string, unknown> = {}
    circular.self = circular

    for (const value of [
      /guide/i,
      new Date('2026-01-01T00:00:00.000Z'),
      new Map([['title', 'Guide']]),
      new Set(['Guide']),
      Number.NaN,
      circular
    ]) {
      expect(() => encodeQueryParams({ where: [{ title: value }] } as any)).toThrow(/Invalid content query params/)
    }
  })

  test('getContentQuery only accepts encoded path params', async () => {
    const { encodeQueryParams, getContentQuery } = await import('../../packages/content/src/runtime/utils/query')

    const routeEvent: any = {
      context: {
        params: {
          params: `abc123/${encodeQueryParams({ where: [{ path: '/guide' }] } as any)}.json`
        }
      }
    }
    expect(getContentQuery(routeEvent)).toEqual({
      where: [{ path: '/guide' }]
    })

    expect(getContentQuery({ context: { params: {} } } as any)).toEqual({})
  })

  test('getContentQuery rejects invalid encoded params JSON', async () => {
    const { getContentQuery } = await import('../../packages/content/src/runtime/utils/query')

    expect(() => getContentQuery({
      context: { params: { params: 'abc/%7Bbad-json.json' } }
    } as any)).toThrow(/Invalid _params query/)
  })
})
