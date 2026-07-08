import { describe, expect, test, vi } from 'vitest'
import { assertPagefindAvailable, normalizeSearchOptions } from '../../packages/content/src/module/options'

/**
 * T7.3: `pagefind` is an optional peerDependency. The module-setup guard
 * (`assertPagefindAvailable`, called from `module.ts`) must:
 *   - stay silent for every non-pagefind engine (and when search is off), so a
 *     playground without pagefind installed builds fine, and
 *   - fail with one actionable install line when the engine IS pagefind but the
 *     optional package cannot be imported.
 */

const importFails = () => Promise.reject(new Error("Cannot find package 'pagefind'"))
const importOk = () => Promise.resolve({})

describe('assertPagefindAvailable (module-setup optional-peer guard)', () => {
  test('does nothing when search is disabled', async () => {
    const importSpy = vi.fn(importFails)
    await expect(assertPagefindAvailable(normalizeSearchOptions({ search: false }), importSpy)).resolves.toBeUndefined()
    expect(importSpy).not.toHaveBeenCalled()
  })

  test('does nothing for the default (minisearch) engine even if pagefind is absent', async () => {
    const importSpy = vi.fn(importFails)
    await expect(assertPagefindAvailable(normalizeSearchOptions({ search: {} }), importSpy)).resolves.toBeUndefined()
    expect(importSpy).not.toHaveBeenCalled()
  })

  test('does nothing for the cms engine', async () => {
    const importSpy = vi.fn(importFails)
    await expect(assertPagefindAvailable(normalizeSearchOptions({ search: { engine: 'cms' } }), importSpy)).resolves.toBeUndefined()
    expect(importSpy).not.toHaveBeenCalled()
  })

  test('resolves when engine is pagefind and the package imports', async () => {
    await expect(assertPagefindAvailable(normalizeSearchOptions({ search: { engine: 'pagefind' } }), importOk)).resolves.toBeUndefined()
  })

  test('throws one actionable install error when engine is pagefind and the import fails', async () => {
    await expect(assertPagefindAvailable(normalizeSearchOptions({ search: { engine: 'pagefind' } }), importFails))
      .rejects.toThrow(/pagefind.*not installed.*pnpm add -D pagefind/s)
  })
})
