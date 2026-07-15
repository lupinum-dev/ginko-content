import { beforeEach, describe, expect, test, vi } from 'vitest'

const cookie = { value: null as string | null }
const query: Record<string, unknown> = {}
const warningShown = { value: false }

vi.mock('#imports', () => ({
  useCookie: () => cookie,
  useRoute: () => ({ query }),
  useState: () => warningShown
}))

describe('content preview composable', () => {
  beforeEach(() => {
    cookie.value = null
    warningShown.value = false
    for (const key of Object.keys(query)) Reflect.deleteProperty(query, key)
  })

  test('uses the Nuxt cookie as the single preview-token store', async () => {
    const { useContentPreview } =
      await import('../../packages/content/src/runtime/app/composables/preview')
    const preview = useContentPreview()

    expect(preview.getPreviewToken()).toBeUndefined()
    expect(preview.isEnabled()).toBe(false)

    preview.setPreviewToken('secret')
    expect(cookie.value).toBe('secret')
    expect(preview.getPreviewToken()).toBe('secret')
    expect(preview.isEnabled()).toBe(true)

    preview.setPreviewToken(undefined)
    expect(cookie.value).toBeNull()
    expect(preview.isEnabled()).toBe(false)
  })

  test('keeps an explicit empty preview query authoritative over the cookie', async () => {
    const { useContentPreview } =
      await import('../../packages/content/src/runtime/app/composables/preview')
    cookie.value = 'secret'
    query.preview = ''

    expect(useContentPreview().isEnabled()).toBe(false)
  })
})
