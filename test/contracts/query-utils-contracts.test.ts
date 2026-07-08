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
  test('encode/decodeQueryParams round-trip regexes and long payloads', async () => {
    const { encodeQueryParams, decodeQueryParams } = await import('../../packages/content/src/runtime/utils/query')

    const params = {
      where: [
        { path: /^\/guide\/.+/ },
        { draft: { $ne: true } }
      ],
      only: ['title', 'path'],
      without: ['body'],
      sort: [{ 'file.stem': 1, $numeric: true }],
      limit: 10
    } as any

    const encoded = encodeQueryParams(params)
    expect(encoded).toContain('/')

    const decoded = decodeQueryParams(encoded)
    expect(decoded.where[0]!.path).toBeInstanceOf(RegExp)
    expect(String(decoded.where[0]!.path)).toBe(String(params.where[0]!.path))
    expect(decoded.only).toEqual(['title', 'path'])
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
