import { describe, expect, it } from 'vitest'

import { CACHE_VERSION } from '../../packages/content/src/utils'

describe('content cache format', () => {
  it('invalidates cached ASTs after canonical Comark normalization changed', () => {
    expect(CACHE_VERSION).toBe(4)
  })
})
