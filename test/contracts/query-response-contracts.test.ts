import { describe, expect, test } from 'vitest'
import {
  unwrapCursorFindResponse,
  unwrapFindResponse,
  unwrapListResponse,
  unwrapOneResponse
} from '../../packages/content/src/features/query/responses'

describe('query response contracts', () => {
  test('unwrapOneResponse accepts only the canonical envelope or serialized null', () => {
    expect(unwrapOneResponse<{ title: string }>({ result: { title: 'Intro' } })).toEqual({ title: 'Intro' })
    expect(unwrapOneResponse<{ title: string }>({ result: undefined })).toBeNull()
    expect(unwrapOneResponse<{ title: string }>(null)).toBeNull()
    expect(() => unwrapOneResponse(undefined)).toThrow('expected a single-result envelope')
    expect(() => unwrapOneResponse({ result: null })).toThrow('expected a single-result envelope')
    expect(() => unwrapOneResponse({ result: [{ title: 'Intro' }] })).toThrow('expected a single-result envelope')
    expect(() => unwrapOneResponse({ title: 'Intro' })).toThrow('expected a single-result envelope')
    expect(() => unwrapOneResponse({})).toThrow('expected a single-result envelope')
  })

  test('unwrapListResponse accepts only canonical offset envelopes', () => {
    expect(unwrapListResponse<{ title: string }>({
      result: [{ title: 'Intro' }],
      skip: 0,
      limit: 10,
      total: 1
    })).toEqual([{ title: 'Intro' }])
    expect(() => unwrapListResponse([{ title: 'Intro' }])).toThrow('expected an offset-list envelope')
    expect(() => unwrapListResponse({ title: 'Intro' })).toThrow('expected an offset-list envelope')
    for (const response of [
      { result: [], skip: -1, limit: 10, total: 0 },
      { result: [], skip: 0, limit: Number.NaN, total: 0 },
      { result: [], skip: 0, limit: 10, total: -1 },
      { result: [], skip: 0, limit: 10, total: 0, extra: true }
    ]) {
      expect(() => unwrapListResponse(response)).toThrow('expected an offset-list envelope')
    }
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
      total: 42
    })
  })

  test('unwrapCursorFindResponse rejects malformed cursor envelopes', () => {
    expect(unwrapCursorFindResponse({
      mode: 'cursor',
      result: [{ title: 'Intro' }],
      limit: 1,
      pageInfo: { endCursor: null, hasNext: false }
    })).toMatchObject({ result: [{ title: 'Intro' }], limit: 1, endCursor: null, hasNext: false })
    expect(() => unwrapCursorFindResponse([])).toThrow('expected a cursor-list envelope')
    expect(() => unwrapCursorFindResponse({
      mode: 'cursor',
      result: [],
      limit: 1,
      pageInfo: { endCursor: null }
    })).toThrow('expected a cursor-list envelope')
    expect(() => unwrapCursorFindResponse({
      mode: 'cursor',
      result: [],
      limit: 1,
      pageInfo: { endCursor: '', hasNext: true }
    })).toThrow('expected a cursor-list envelope')
    expect(() => unwrapCursorFindResponse({
      mode: 'cursor',
      result: [],
      limit: 1,
      pageInfo: { endCursor: null, hasNext: false, extra: true }
    })).toThrow('expected a cursor-list envelope')
  })
})
