import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ContentProviderQueryInput } from '../../packages/content/src/types/query'
import type { ResolvedCollectionLocalePolicy } from '../../packages/content/src/features/localization/locale-policy'
import { collectMountedPathSelectorMissDiagnostic } from '../../packages/content/src/features/query/diagnostics'
import { shouldEmitRuntimeDiagnostics } from '../../packages/content/src/core/runtime-diagnostics'

const localePolicy = {
  localized: true,
  locales: ['en', 'de'],
  defaultLocale: 'en',
  fallback: { de: ['en'] },
  translatedSlugs: false,
  routeMounts: { en: '/guide', de: '/leitfaden' }
} satisfies ResolvedCollectionLocalePolicy

const runtimeConfig = { collections: { docs: { localePolicy } } }

const missFor = (path: string, locale = 'en') => ({
  collection: 'docs',
  first: true,
  resolveVariant: { path, locale }
}) satisfies ContentProviderQueryInput

const loadNormalizer = async (environment: 'development' | 'production') => {
  vi.resetModules()
  vi.doMock('../../packages/content/src/core/visibility', async () => {
    const actual = await vi.importActual<typeof import('../../packages/content/src/core/visibility')>(
      '../../packages/content/src/core/visibility'
    )
    return { ...actual, resolveRuntimeEnvironment: () => environment }
  })
  const module = await import('../../packages/content/src/runtime/server/provider-query')
  return module.normalizeProviderQueryResponse
}

describe('query diagnostics', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('collects an advisory mounted-path diagnosis without claiming it is definitive', () => {
    const diagnostic = collectMountedPathSelectorMissDiagnostic(
      missFor('/guide/getting-started'),
      localePolicy
    )

    expect(diagnostic).toMatchObject({
      key: 'path-selector-miss:docs:en:/guide/getting-started'
    })
    expect(diagnostic?.message).toContain('"/guide"')
    expect(diagnostic?.message).toContain('"/getting-started"')
    expect(diagnostic?.message).toContain('genuinely canonical')
    expect(diagnostic?.message).not.toMatch(/did you mean/i)
  })

  test('does not diagnose an ordinary canonical miss outside the mount', () => {
    expect(collectMountedPathSelectorMissDiagnostic(
      missFor('/getting-startd'),
      localePolicy
    )).toBeUndefined()
  })

  test('keeps a mount-shaped canonical path explicitly possible', () => {
    const diagnostic = collectMountedPathSelectorMissDiagnostic(
      missFor('/guide/intro'),
      localePolicy
    )

    expect(diagnostic?.message).toContain(
      'If "/guide/intro" is genuinely canonical, no such document exists.'
    )
  })

  test('enables diagnostics only for development and prerender', () => {
    expect(shouldEmitRuntimeDiagnostics('development', false)).toBe(true)
    expect(shouldEmitRuntimeDiagnostics('production', true)).toBe(true)
    expect(shouldEmitRuntimeDiagnostics('production', false)).toBe(false)
  })

  test('emits a development hint once without changing the miss response', async () => {
    const normalize = await loadNormalizer('development')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const normalizeMiss = () => normalize(
      missFor('/guide/getting-started'),
      { result: undefined },
      'filesystem',
      runtimeConfig as never
    )

    expect(normalizeMiss()).toEqual({ result: undefined })
    expect(normalizeMiss()).toEqual({ result: undefined })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  test('keeps the same miss silent in production', async () => {
    const normalize = await loadNormalizer('production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(normalize(
      missFor('/guide/getting-started'),
      { result: undefined },
      'filesystem',
      runtimeConfig as never
    )).toEqual({ result: undefined })
    expect(warn).not.toHaveBeenCalled()
  })
})
