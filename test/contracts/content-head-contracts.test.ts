import { describe, expect, test } from 'vitest'

const route = {
  path: '/docs/getting-started',
  fullPath: '/docs/getting-started'
}

const config = {
  app: { baseURL: '/' },
  public: { siteUrl: 'https://example.com' }
}

describe('content head contracts', () => {
  test('resolves common page metadata from an explicit content document', async () => {
    const { resolveContentHead } = await import('../../packages/content/src/runtime/app/composables/head')

    const head = resolveContentHead({
      title: 'Getting Started',
      description: 'Start here.'
    }, route, config)

    expect(head).toEqual(expect.objectContaining({
      title: 'Getting Started',
      meta: expect.arrayContaining([
        { name: 'description', content: 'Start here.' }
      ])
    }))
  })

  test('does not emit head tags for missing content', async () => {
    const { resolveContentHead } = await import('../../packages/content/src/runtime/app/composables/head')

    expect(resolveContentHead(undefined, route, config)).toBeNull()
  })
})
