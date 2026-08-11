import { describe, expect, test, vi } from 'vitest'
import { isContentProviderResult, withContentCache } from '../../packages/content/src/public/provider'
import { unwrapContentProviderResult } from '../../packages/content/src/runtime/server/provider-result'
import { getContentCacheHint } from '../../packages/content/src/runtime/server/cache-hints'
import { createTestEvent } from '../support/provider-scenarios/event'

const mocks = vi.hoisted(() => ({
  getContentRuntimeConfig: vi.fn(() => ({ content: {} }))
}))

vi.mock('../../packages/content/src/runtime/server/runtime-config', () => ({
  getContentRuntimeConfig: mocks.getContentRuntimeConfig
}))

vi.mock('../../packages/content/src/integrations/nitro/runtime-config', () => ({
  getContentRuntimeConfig: mocks.getContentRuntimeConfig
}))

describe('provider result boundary', () => {
  test('uses an explicit marker and does not collide with content fields', () => {
    mocks.getContentRuntimeConfig.mockReturnValue({ content: {} })
    const event = createTestEvent()
    const rawDocument = { data: 'frontmatter data', cache: 'frontmatter cache' }

    expect(isContentProviderResult(rawDocument)).toBe(false)
    expect(unwrapContentProviderResult(event as any, rawDocument)).toBe(rawDocument)
    expect(unwrapContentProviderResult(event as any, withContentCache(rawDocument, { tags: ['entry:docs:a'] }))).toBe(rawDocument)
    expect(getContentCacheHint(event as any)).toMatchObject({ tags: ['entry:docs:a'] })
  })

  test('preview requests opt out of public cache hints', () => {
    mocks.getContentRuntimeConfig.mockReturnValue({ content: { preview: { token: 'preview-secret' } } })
    const event = {
      ...createTestEvent(),
      node: {
        req: {
          url: '/',
          headers: {
            'x-nuxt-content-preview': 'preview-secret'
          }
        }
      },
      web: {
        request: new Request('http://content.local/', {
          headers: {
            'x-nuxt-content-preview': 'preview-secret'
          }
        })
      }
    }

    unwrapContentProviderResult(event as any, withContentCache({ title: 'Draft' }, { tags: ['entry:docs:draft'] }))

    expect(getContentCacheHint(event as any)).toBe(false)
  })
})
