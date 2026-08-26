import { describe, expect, test } from 'vitest'
import { resolveLoadedPage } from '../../playground/ginko-agent-output/page-result'

const result = <T>(data: T | null, error?: unknown) => ({
  data: { value: data },
  error: { value: error }
})

describe('agent output page result', () => {
  test('returns the first loaded page', () => {
    expect(resolveLoadedPage([result(null), result({ path: '/guide' })])).toEqual({ path: '/guide' })
  })

  test('keeps an ordinary miss distinct from a load failure', () => {
    expect(resolveLoadedPage([result(null), result(null)])).toBeUndefined()
    expect(() => resolveLoadedPage([result(null), result(null, new Error('provider unavailable'))]))
      .toThrow('provider unavailable')
  })
})
