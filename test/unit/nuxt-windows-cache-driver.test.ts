import { describe, expect, test, vi } from 'vitest'
import { createNuxtWindowsCacheDriverResolver } from '../../packages/content/src/module/nitro-config'

describe('Nuxt Windows cache-driver compatibility', () => {
  test('converts only Nuxt Nitro cache-driver file URLs on Windows', () => {
    const fromFileURL = vi.fn(() => 'C:\\repo\\node_modules\\@nuxt\\nitro-server\\dist\\runtime\\utils\\cache-driver.mjs')
    const resolver = createNuxtWindowsCacheDriverResolver('win32', fromFileURL)
    const cacheDriver = 'file:///C:/repo/node_modules/@nuxt/nitro-server/dist/runtime/utils/cache-driver.mjs'

    expect(resolver?.resolveId(cacheDriver)).toBe('C:\\repo\\node_modules\\@nuxt\\nitro-server\\dist\\runtime\\utils\\cache-driver.mjs')
    expect(fromFileURL).toHaveBeenCalledOnce()
    expect(fromFileURL.mock.calls[0]?.[0].href).toBe(cacheDriver)
  })

  test.each([
    'file:///C:/repo/node_modules/@nuxt/nitro-server/dist/runtime/utils/other.mjs',
    'file://server/share/node_modules/@nuxt/nitro-server/dist/runtime/utils/cache-driver.mjs',
    'file:///C:/repo/node_modules/@nuxt/nitro-server/dist/runtime/utils/cache-driver.mjs?external=true',
    'https://example.com/node_modules/@nuxt/nitro-server/dist/runtime/utils/cache-driver.mjs',
    'not a URL'
  ])('does not broaden resolution for %s', (id) => {
    const fromFileURL = vi.fn(() => 'unexpected')
    const resolver = createNuxtWindowsCacheDriverResolver('win32', fromFileURL)

    expect(resolver?.resolveId(id)).toBeNull()
    expect(fromFileURL).not.toHaveBeenCalled()
  })

  test('does not install outside Windows', () => {
    expect(createNuxtWindowsCacheDriverResolver('linux')).toBeUndefined()
    expect(createNuxtWindowsCacheDriverResolver('darwin')).toBeUndefined()
  })
})
