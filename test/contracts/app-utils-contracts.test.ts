import { describe, expect, test } from 'vitest'

import { addPrerenderPath } from '../../packages/content/src/runtime/app/composables/utils'

describe('app utils contracts', () => {
  test('ignores unavailable Nuxt request context without relying on global bridges', () => {
    expect(() => addPrerenderPath('/api/_content/query/later.json')).not.toThrow()
  })
})
