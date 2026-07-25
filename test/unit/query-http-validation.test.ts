import { describe, expect, test } from 'vitest'
import {
  MAX_ARRAY_OPERAND_LENGTH,
  MAX_FILTER_DEPTH,
  MAX_LOGICAL_GROUP_MEMBERS,
  MAX_LOCALE_NAME_LENGTH,
  MAX_QUERY_REQUEST_BYTES,
  MAX_SELECTION_ENTRIES,
  MAX_SORT_ENTRIES,
  isOversizedQueryRequestBody,
  validateContentQueryRequestBody
} from '../../packages/content/src/runtime/server/query-http-validation'
import { MAX_PUBLIC_QUERY_CURSOR_BYTES } from '../../packages/content/src/core/query/limits'

/**
 * Closed HTTP boundary validation. `validateContentQueryRequestBody`
 * is a pure function: transport budgets are checked here and query semantics
 * are delegated to the canonical lowerer without H3 or provider dispatch.
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

  test('counts arrays toward the depth budget and rejects hostile array nesting structurally', () => {
    let operand: unknown = 'value'
    for (let depth = 0; depth < 5_000; depth += 1) {
      operand = [operand]
    }

    const result = validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ value: { $eq: operand } }]
    })
    expect(result).toMatchObject({
      ok: false,
      error: {
        reason: `Filter nesting exceeds maximum depth of ${MAX_FILTER_DEPTH}.`
      }
    })
  })

  test('accepts depth 8 and rejects depth 9 for otherwise valid operands', () => {
    const nestedArrays = (levels: number) => {
      let value: unknown = 'value'
      for (let depth = 0; depth < levels; depth += 1) value = [value]
      return value
    }

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ value: { $eq: nestedArrays(5) } }]
    }).ok).toBe(true)
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ value: { $eq: nestedArrays(6) } }]
    })).toMatchObject({
      ok: false,
      error: { reason: `Filter nesting exceeds maximum depth of ${MAX_FILTER_DEPTH}.` }
    })
  })

  test('rejects excessive $and/$or member counts', () => {
    const members = Array.from({ length: MAX_LOGICAL_GROUP_MEMBERS + 1 }, (_, index) => ({ order: index }))
    const result = validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ $or: members }]
    })
    expect(result.ok).toBe(false)
  })

  test('rejects empty or ambiguous filters instead of accepting match-all no-ops', () => {
    for (const where of [
      [],
      [{}],
      [{ $and: [] }],
      [{ $or: [] }],
      [{ $not: {} }],
      [{ nested: {} }],
      [{ status: { $eq: 'draft', nested: true } }]
    ]) {
      expect(validateContentQueryRequestBody({ collection: 'posts', where }).ok).toBe(false)
    }
  })

  test('rejects non-object top-level $not operands', () => {
    for (const value of [true, 'published', null, [{ published: true }]]) {
      expect(validateContentQueryRequestBody({
        collection: 'posts',
        where: [{ $not: value }]
      } as never)).toMatchObject({
        ok: false,
        error: { path: '$.where[0].$not' }
      })
    }
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

    for (const [operator, operand] of [
      ['$in', 'published'],
      ['$nin', 'archived'],
      ['$containsAny', 'nuxt'],
      ['$icontains', 42],
      ['$prefix', 42],
      ['$type', 'function']
    ] as const) {
      expect(validateContentQueryRequestBody({
        collection: 'posts',
        where: [{ title: { [operator]: operand } }]
      }), operator).toMatchObject({ ok: false })
    }
  })

  test('rejects non-JSON object instances as operands', () => {
    for (const operand of [/guide/i, new Date('2026-01-01T00:00:00Z'), new Map([['title', 'Guide']])]) {
      expect(validateContentQueryRequestBody({
        collection: 'posts',
        where: [{ title: operand }]
      } as never)).toMatchObject({ ok: false })
    }
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
      paging: { mode: 'cursor', after: 'x'.repeat(MAX_PUBLIC_QUERY_CURSOR_BYTES + 1), limit: 10 }
    }).ok).toBe(false)
  })

  test('requires a positive limit for explicit offset and cursor paging', () => {
    for (const paging of [
      { mode: 'offset', skip: 0, limit: 0 },
      { mode: 'cursor', after: null, limit: 0 }
    ] as const) {
      expect(validateContentQueryRequestBody({
        collection: 'posts',
        paging
      })).toMatchObject({
        ok: false,
        error: {
          path: '$.paging.limit',
          reason: expect.stringMatching(/positive integer/u)
        }
      })
    }

    // Plain list limiting keeps its existing zero-value semantics. Only
    // explicit page iteration must make forward progress.
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      limit: 0
    }).ok).toBe(true)
  })

  test('rejects contradictory terminal and paging modes', () => {
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      first: true,
      count: true
    })).toMatchObject({ ok: false, error: { path: '$.first' } })

    for (const terminal of [{ first: true }, { count: true }]) {
      expect(validateContentQueryRequestBody({
        collection: 'posts',
        ...terminal,
        paging: { mode: 'offset', skip: 0, limit: 10 }
      })).toMatchObject({ ok: false, error: { path: '$.paging' } })
    }
  })

  test('rejects duplicate top-level pagination values whenever `paging` is present', () => {
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

    // Cursor paging is fine as long as no duplicate top-level values ride along.
    expect(validateContentQueryRequestBody({
      collection: 'posts',
      paging: { mode: 'cursor', after: 'opaque-cursor-value', limit: 10 }
    }).ok).toBe(true)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      skip: 5,
      paging: { mode: 'offset', skip: 0, limit: 10 }
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      limit: 5,
      paging: { mode: 'offset', skip: 0, limit: 10 }
    })).toMatchObject({ ok: false, error: { path: '$.limit' } })
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

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      sort: [{ title: 1, $caseFirst: false } as never]
    }).ok).toBe(false)

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      sort: [{ title: 1, $sensitivity: false } as never]
    }).ok).toBe(false)

    for (const locale of ['', 'not_a_locale', 'x'.repeat(MAX_LOCALE_NAME_LENGTH + 1)]) {
      expect(validateContentQueryRequestBody({
        collection: 'posts',
        sort: [{ title: 1, $locale: locale }]
      })).toMatchObject({ ok: false, error: { path: '$.sort[0].$locale' } })
    }
  })

  test('rejects empty and prototype-traversing field paths on every query surface', () => {
    const invalidPaths = [
      '',
      '.title',
      'meta..title',
      'meta.__proto__.title',
      'prototype.name',
      'author.constructor.name'
    ]

    for (const field of invalidPaths) {
      expect(validateContentQueryRequestBody({
        collection: 'posts',
        where: [{ [field]: true }]
      }), `where: ${field}`).toMatchObject({ ok: false })

      expect(validateContentQueryRequestBody({
        collection: 'posts',
        sort: [{ [field]: 1 }]
      }), `sort: ${field}`).toMatchObject({ ok: false })

      expect(validateContentQueryRequestBody({
        collection: 'posts',
        only: [field]
      }), `only: ${field}`).toMatchObject({ ok: false })

      expect(validateContentQueryRequestBody({
        collection: 'posts',
        without: [field]
      }), `without: ${field}`).toMatchObject({ ok: false })
    }

    expect(validateContentQueryRequestBody({
      collection: 'posts',
      where: [{ meta: { constructor: { name: 'Object' } } }]
    })).toMatchObject({ ok: false })
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
