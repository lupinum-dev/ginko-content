import { describe, expect, test } from 'vitest'
import { createContentValidationRouteFacts } from '../../packages/content/src/module/validation-routes'

describe('content validation route facts', () => {
  test('preserves nested Nuxt page paths and excludes catch-alls as existence proof', () => {
    const facts = createContentValidationRouteFacts([
      {
        path: '/users',
        name: 'users',
        children: [{ path: ':id', name: 'user' }]
      },
      { path: '/:pathMatch(.*)*', name: 'catch-all' }
    ])

    expect(facts.patterns.some(pattern => new RegExp(pattern.source, pattern.flags).test('/users/42'))).toBe(true)
    expect(facts.patterns.some(pattern => new RegExp(pattern.source, pattern.flags).test('/definitely-missing'))).toBe(false)
    expect(facts.named).toEqual(expect.objectContaining({
      user: { requiredParams: ['id'] },
      users: { requiredParams: [] }
    }))
    expect(facts.named).not.toHaveProperty('catch-all')
  })
})
