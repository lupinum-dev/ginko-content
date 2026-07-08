import { describe, expect, test } from 'vitest'
import {
  unwrapCountResponse,
  unwrapFindResponse,
  unwrapListResponse,
  unwrapOneResponse
} from '../../packages/content/src/features/query/responses'

describe('query response contracts', () => {
  test('unwrapOneResponse accepts result envelopes and raw documents', () => {
    expect(unwrapOneResponse<{ title: string }>({ result: { title: 'Intro' } })).toEqual({ title: 'Intro' })
    expect(unwrapOneResponse<{ title: string }>({ title: 'Intro' })).toEqual({ title: 'Intro' })
    expect(unwrapOneResponse(undefined)).toBeNull()
  })

  test('unwrapListResponse accepts list envelopes arrays and raw documents', () => {
    expect(unwrapListResponse<{ title: string }>({
      result: [{ title: 'Intro' }],
      skip: 0,
      limit: 10,
      total: 1
    })).toEqual([{ title: 'Intro' }])
    expect(unwrapListResponse([{ title: 'Intro' }])).toEqual([{ title: 'Intro' }])
    expect(unwrapListResponse({ title: 'Intro' })).toEqual([{ title: 'Intro' }])
  })

  test('unwrapFindResponse preserves pagination envelope metadata', () => {
    expect(unwrapFindResponse<{ title: string }>({
      result: [{ title: 'Intro' }],
      skip: 10,
      limit: 5,
      total: 42
    })).toEqual({
      result: [{ title: 'Intro' }],
      skip: 10,
      limit: 5,
      total: 42,
      hasTotal: true
    })
  })

  test('unwrapCountResponse accepts numbers and count envelopes only', () => {
    expect(unwrapCountResponse(3)).toBe(3)
    expect(unwrapCountResponse({ result: 3 })).toBe(3)
    expect(unwrapCountResponse({ result: [{ title: 'Intro' }], skip: 0, limit: 1, total: 1 })).toBeNull()
  })
})
