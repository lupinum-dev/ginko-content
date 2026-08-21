import { beforeEach, describe, expect, test, vi } from 'vitest'
import { compileQueryParams } from '../../packages/content/src/core/query/filter'
import { count } from '../../packages/content/src/features/query/unified'
import { unwrapCountResponse } from '../../packages/content/src/features/query/responses'
import { defineCollection, defineContentConfig } from '../../packages/content/src/types/config'
import type { ContentQueryContext } from '../../packages/content/src/features/query/context'

const transport = vi.fn()
const context = (): ContentQueryContext => ({ runtime: {}, transport }) as ContentQueryContext
const config = defineContentConfig({
  collections: {
    docs: defineCollection({ type: 'page', source: 'docs/*.md' })
  }
})

describe('count()', () => {
  beforeEach(() => transport.mockReset())

  test('compiles a count terminal without paging or selection', () => {
    const params = compileQueryParams({
      collection: 'docs',
      where: { draft: { $ne: true } },
      count: true
    })

    expect(params).toMatchObject({ collection: 'docs', count: true })
    expect(params.limit).toBeUndefined()
    expect(params.skip).toBeUndefined()
    expect(params.only).toBeUndefined()
  })

  test('rejects an invalid count flag', () => {
    expect(() => compileQueryParams({
      collection: 'docs',
      count: 'yes' as unknown as boolean
    })).toThrow('Invalid content query count option')
  })

  test('returns the count and maps a 404 to zero', async () => {
    transport.mockResolvedValueOnce({ result: 7 })
    await expect(count(context(), config.collections.docs)).resolves.toBe(7)
    expect(transport).toHaveBeenCalledWith('query', expect.objectContaining({ count: true }))

    transport.mockRejectedValueOnce(Object.assign(new Error('Missing'), { statusCode: 404 }))
    await expect(count(context(), config.collections.docs)).resolves.toBe(0)
  })

  test('rethrows non-404 failures', async () => {
    transport.mockRejectedValueOnce(new Error('boom'))
    await expect(count(context(), config.collections.docs)).rejects.toThrow('boom')
  })
})

describe('unwrapCountResponse', () => {
  test('accepts only a non-negative integer result envelope', () => {
    expect(unwrapCountResponse({ result: 3 })).toBe(3)
    expect(unwrapCountResponse({ result: 0 })).toBe(0)

    for (const invalid of [{ result: '3' }, { result: -1 }, { result: [1] }, {}]) {
      expect(() => unwrapCountResponse(invalid)).toThrow('expected { result: number }')
    }
  })
})
