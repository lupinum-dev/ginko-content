import { beforeEach, describe, expect, test, vi } from 'vitest'

describe('content runtime context', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('../../packages/content/src/integrations/nitro/runtime-config', () => ({
      getContentRuntimeConfig: () => ({ content: {} })
    }))
  })

  test('memoizeRuntimeValue shares the same pending computation within one request', async () => {
    const { memoizeRuntimeValue } = await import('../../packages/content/src/integrations/nitro/context')
    const event = { context: {} } as any
    let calls = 0
    let release!: (value: string[]) => void
    const pending = new Promise<string[]>(resolve => {
      release = resolve
    })

    const first = memoizeRuntimeValue(event, 'contents', async () => {
      calls += 1
      return await pending
    })
    const second = memoizeRuntimeValue(event, 'contents', async () => {
      calls += 1
      return ['wrong']
    })

    release(['ok'])

    await expect(Promise.all([first, second])).resolves.toEqual([['ok'], ['ok']])
    expect(calls).toBe(1)
  })

  test('memoizeRuntimeValue clears rejected pending computations so callers can retry', async () => {
    const { memoizeRuntimeValue } = await import('../../packages/content/src/integrations/nitro/context')
    const event = { context: {} } as any
    let calls = 0

    await expect(memoizeRuntimeValue(event, 'contents', async () => {
      calls += 1
      throw new Error('boom')
    })).rejects.toThrow('boom')

    await expect(memoizeRuntimeValue(event, 'contents', async () => {
      calls += 1
      return ['ok']
    })).resolves.toEqual(['ok'])
    expect(calls).toBe(2)
  })
})
