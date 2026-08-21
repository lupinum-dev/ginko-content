import { beforeEach, describe, expect, test, vi } from 'vitest'
import { compileQueryParams } from '../../packages/content/src/core/query/filter'
import { count } from '../../packages/content/src/features/query/unified'
import { unwrapCountResponse } from '../../packages/content/src/features/query/responses'
import { defineCollection, defineContentConfig } from '../../packages/content/src/types/config'
import type { ContentQueryContext } from '../../packages/content/src/features/query/context'

const mocks = vi.hoisted(() => ({
  transport: vi.fn()
}))

const context = (): ContentQueryContext => ({
  runtime: {},
  transport: mocks.transport
}) as unknown as ContentQueryContext

const config = defineContentConfig({
  collections: {
    docs: defineCollection({ type: 'page', source: 'docs/*.md' })
  }
})

describe('count()', () => {
  beforeEach(() => {
    mocks.transport.mockReset()
  })

  test('compiles a count terminal without paging or selection', () => {
    const params = compileQueryParams({
      collection: 'docs',
      where: { draft: { $ne: true } },
      count: true
    })

    expect(params.count).toBe(true)
    expect(params.limit).toBeUndefined()
    expect(params.skip).toBeUndefined()
    expect(params.only).toBeUndefined()
  })

  test('rejects a non-boolean count option', () => {
    expect(() => compileQueryParams({
      collection: 'docs',
      count: 'yes' as unknown as boolean
    })).toThrow('Invalid content query count option')
  })

  test('returns the matched document count', async () => {
    mocks.transport.mockResolvedValue({ result: 7 })

    await expect(count(context(), config.collections.docs, {
      where: { draft: { $ne: true } }
    })).resolves.toBe(7)

    expect(mocks.transport).toHaveBeenCalledWith('query', expect.objectContaining({ count: true }))
  })

  test('options are optional for non-i18n collections', async () => {
    mocks.transport.mockResolvedValue({ result: 0 })

    await expect(count(context(), config.collections.docs)).resolves.toBe(0)
  })

  test('resolves a missing collection to zero instead of throwing', async () => {
    mocks.transport.mockRejectedValue(Object.assign(new Error('Not found'), { statusCode: 404 }))

    await expect(count(context(), config.collections.docs)).resolves.toBe(0)
  })

  test('rethrows non-404 transport errors', async () => {
    mocks.transport.mockRejectedValue(new Error('boom'))

    await expect(count(context(), config.collections.docs)).rejects.toThrow('boom')
  })
})

describe('unwrapCountResponse', () => {
  test('accepts the canonical count envelope', () => {
    expect(unwrapCountResponse({ result: 3 })).toBe(3)
    expect(unwrapCountResponse({ result: 0 })).toBe(0)
  })

  test('rejects non-count envelopes', () => {
    expect(() => unwrapCountResponse({ result: '3' })).toThrow('expected { result: number }')
    expect(() => unwrapCountResponse({ result: -1 })).toThrow('expected { result: number }')
    expect(() => unwrapCountResponse({ result: [1, 2] })).toThrow('expected { result: number }')
    expect(() => unwrapCountResponse({})).toThrow('expected { result: number }')
  })
})
