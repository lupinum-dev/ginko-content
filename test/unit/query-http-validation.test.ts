import { describe, expect, test } from 'vitest'
import {
  MAX_ARRAY_OPERAND_LENGTH,
  MAX_CURSOR_BYTES,
  MAX_FILTER_DEPTH,
  MAX_LOGICAL_GROUP_MEMBERS,
  MAX_QUERY_REQUEST_BYTES,
  MAX_SELECTION_ENTRIES,
  MAX_SORT_ENTRIES,
  isOversizedQueryRequestBody,
  validateContentQueryRequestBody
} from '../../packages/content/src/runtime/server/query-http-validation'

/**
 * Closed HTTP boundary validation. `validateContentQueryRequestBody`
 * is a pure function — every case here runs without H3, a provider, or the
 * query lowerer, proving the boundary can reject before either ever runs.
 */
describe('content query HTTP request validation', () => {
  test('accepts a well-formed request', () => {
    const result = validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ published: true }],
      sort: [{ date: -1 }],
      only: ['title', 'path'],
      skip: 0,
      limit: 10
    })
    expect(result.ok).toBe(true)
  })

  test('rejects a non-object body', () => {
    expect(validateContentQueryRequestBody(null).ok).toBe(false)
    expect(validateContentQueryRequestBody('nope').ok).toBe(false)
    expect(validateContentQueryRequestBody([1, 2, 3]).ok).toBe(false)
  })

  test('rejects unknown top-level keys', () => {
    const result = validateContentQueryRequestBody({
      collection: 'posts',
      hackAttempt: true
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.path).toBe('$.hackAttempt')
    }
  })

  test('rejects unknown nested keys inside resolveLocale/resolveVariant/paging', () => {
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      resolveLocale: { locale: 'de', extra: true }
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      resolveVariant: { route: '/docs', extra: true }
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      paging: { mode: 'offset', skip: 0, limit: 10, extra: true }
    }).ok).toBe(false)
  })

  test('rejects excessive filter nesting depth', () => {
    let where: Record<string, unknown> = { $and: [{ published: true }] }
    for (let depth = 0; depth < MAX_FILTER_DEPTH + 5; depth += 1) {
      where = { $and: [where] }
    }

    const result = validateContentQueryRequestBody({ collection: 'posts', where: [where] })
    expect(result.ok).toBe(false)
  })

  test('rejects excessive $and/$or member counts', () => {
    const members = Array.from({ length: MAX_LOGICAL_GROUP_MEMBERS + 1 }, (_, index) => ({ order: index }))
    const result = validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ $or: members }]
    })
    expect(result.ok).toBe(false)
  })

  test('accepts exactly the logical-group member limit', () => {
    const members = Array.from({ length: MAX_LOGICAL_GROUP_MEMBERS }, (_, index) => ({ order: index }))
    const result = validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ $or: members }]
    })
    expect(result.ok).toBe(true)
  })

  test('rejects an unknown operator before lowering would ever see it', () => {
    const result = validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ title: { $near: 'launch' } }]
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.reason).toMatch(/Unknown query operator/)
    }
  })

  test('rejects wrong operand types for typed operators', () => {
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ published: { $exists: 'yes' } }]
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ title: { $regex: 42 } }]
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ title: { $options: 'i' } }]
    }).ok).toBe(false)
  })

  test('rejects negative, fractional, non-finite, and oversized paging numbers', () => {
    for (const skip of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10 ** 9]) {
      expect(validateContentQueryRequestBody({ collection: 'posts', skip }).ok).toBe(false)
    }
    for (const limit of [-1, 2.5, Number.NaN, Number.NEGATIVE_INFINITY, 10 ** 9]) {
      expect(validateContentQueryRequestBody({ collection: 'posts', limit }).ok).toBe(false)
    }
    // Numeric strings are not accepted — the wire is JSON-typed, not stringly-typed.
    expect(validateContentQueryRequestBody({ collection: 'posts', skip: '5' as never }).ok).toBe(false)
  })

  test('rejects offset/cursor mixed paging shapes', () => {
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      paging: { mode: 'offset', skip: 0, limit: 10, after: 'x' } as never
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      paging: { mode: 'cursor', after: null, limit: 10, skip: 0 } as never
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      paging: { mode: 'weird', limit: 10 } as never
    }).ok).toBe(false)
  })

  test('accepts a well-formed cursor paging request and rejects an oversized cursor', () => {
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      paging: { mode: 'cursor', after: 'opaque-cursor-value', limit: 10 }
    }).ok).toBe(true)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      paging: { mode: 'cursor', after: 'x'.repeat(MAX_CURSOR_BYTES + 1), limit: 10 }
    }).ok).toBe(false)
  })

  test('rejects top-level `skip` combined with cursor paging, in either field order', () => {
    // skip declared before paging
    const skipFirst = validateContentQueryRequestBody({
      collection: 'posts',
      skip: 5,
      paging: { mode: 'cursor', after: 'opaque-cursor-value', limit: 10 } as never
    })
    expect(skipFirst.ok).toBe(false)
    if (!skipFirst.ok) {
      expect(skipFirst.error.path).toBe('$.skip')
    }

    // paging declared before skip — same combination, opposite key order.
    const pagingFirst = validateContentQueryRequestBody({
      collection: 'posts',
      paging: { mode: 'cursor', after: 'opaque-cursor-value', limit: 10 } as never,
      skip: 5
    })
    expect(pagingFirst.ok).toBe(false)

    // skip: 0 is still a present top-level value — must not be treated as absent.
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      skip: 0,
      paging: { mode: 'cursor', after: 'opaque-cursor-value', limit: 10 } as never
    }).ok).toBe(false)

    // The mirror image: cursor paging is fine as long as no top-level skip rides along.
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      paging: { mode: 'cursor', after: 'opaque-cursor-value', limit: 10 }
    }).ok).toBe(true)

    // Offset paging may still carry a top-level `skip` — the conflict is cursor-specific.
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      skip: 5,
      paging: { mode: 'offset', skip: 0, limit: 10 }
    }).ok).toBe(true)
  })

  test('rejects invalid selection and sort entries', () => {
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      only: Array.from({ length: MAX_SELECTION_ENTRIES + 1 }, (_, index) => `field${index}`)
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      only: [42 as never]
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      sort: Array.from({ length: MAX_SORT_ENTRIES + 1 }, () => ({ date: 1 }))
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      sort: [{ date: 2 as never }]
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      sort: [{ date: -1, $unknownParam: true } as never]
    }).ok).toBe(false)
  })

  test('rejects an array operand over the size limit', () => {
    const result = validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ tags: { $in: Array.from({ length: MAX_ARRAY_OPERAND_LENGTH + 1 }, (_, i) => `tag-${i}`) } }]
    })
    expect(result.ok).toBe(false)
  })

  test('rejects a malformed selector XOR on resolveVariant', () => {
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      resolveVariant: {}
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      resolveVariant: { path: '/docs/intro', route: '/docs/intro' }
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      resolveVariant: { ref: 'docs.intro' }
    }).ok).toBe(true)
  })

  test('flags a request body over the byte-size limit before it is even decoded', () => {
    expect(isOversizedQueryRequestBody('x'.repeat(MAX_QUERY_REQUEST_BYTES + 1))).toBe(true)
    expect(isOversizedQueryRequestBody('x'.repeat(10))).toBe(false)
  })
})
