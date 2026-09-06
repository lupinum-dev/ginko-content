import { describe, expect, test, vi } from 'vitest'
import { runtimeModuleImportURL } from '../../packages/content/src/module/static-output'

describe('static output runtime imports', () => {
  test('converts an absolute Windows module path to an importable file URL', () => {
    const toFileURL = vi.fn(() => new URL('file:///C:/repo/server/pagefind.js'))

    expect(runtimeModuleImportURL('C:\\repo\\server\\pagefind.js', toFileURL))
      .toBe('file:///C:/repo/server/pagefind.js')
    expect(toFileURL).toHaveBeenCalledWith('C:\\repo\\server\\pagefind.js')
  })
})
