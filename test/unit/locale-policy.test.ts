import { describe, expect, test } from 'vitest'
import {
  LocalePolicyError,
  resolveLocalePolicy,
  validateLocaleFallback
} from '../../packages/content/src/features/localization/locale-policy'
import type { LocalePolicyInput } from '../../packages/content/src/features/localization/locale-policy'

/**
 * Unit tests for the immutable locale-policy resolver.
 * Pure function — no Nuxt instance required.
 */

const baseInput: LocalePolicyInput = {
  nuxtI18n: { installed: false },
  content: { locales: ['en', 'de'], defaultLocale: 'en', fallback: {}, translatedSlugs: false },
  collections: [{ name: 'docs', localized: true, route: '/docs' }]
}

describe('resolveLocalePolicy — authority', () => {
  test('content-only authority: no Nuxt I18n installed, Ginko locales are authoritative', () => {
    const policy = resolveLocalePolicy(baseInput)
    expect(policy.source).toBe('content')
    expect(policy.locales).toEqual(['en', 'de'])
    expect(policy.defaultLocale).toBe('en')
    expect(policy.strategy).toBe('content-only')
  })

  test('Nuxt I18n authority: locales/defaultLocale come from Nuxt I18n, not content config', () => {
    const policy = resolveLocalePolicy({
      nuxtI18n: { installed: true, locales: ['en', 'fr'], defaultLocale: 'en' },
      content: { fallback: {}, translatedSlugs: true },
      collections: [{ name: 'docs', localized: true, route: '/docs' }]
    })
    expect(policy.source).toBe('nuxt-i18n')
    expect(policy.locales).toEqual(['en', 'fr'])
    expect(policy.defaultLocale).toBe('en')
    expect(policy.strategy).toBe('prefix_except_default')
    expect(policy.translatedSlugs).toBe(true)
  })

  test('duplicate authority: Nuxt I18n installed + content.i18n.locales set fails setup', () => {
    expect(() => resolveLocalePolicy({
      nuxtI18n: { installed: true, locales: ['en', 'fr'], defaultLocale: 'en' },
      content: { locales: ['en', 'de'] },
      collections: []
    })).toThrow(LocalePolicyError)
  })

  test('duplicate authority: Nuxt I18n installed + content.i18n.defaultLocale set fails setup', () => {
    expect(() => resolveLocalePolicy({
      nuxtI18n: { installed: true, locales: ['en', 'fr'], defaultLocale: 'en' },
      content: { defaultLocale: 'fr' },
      collections: []
    })).toThrow(/sole locale\/default-locale authority/)
  })

  test('content.i18n.fallback and content.i18n.translatedSlugs remain allowed under Nuxt I18n authority', () => {
    expect(() => resolveLocalePolicy({
      nuxtI18n: { installed: true, locales: ['en', 'fr'], defaultLocale: 'en' },
      content: { fallback: { fr: ['en'] }, translatedSlugs: true },
      collections: []
    })).not.toThrow()
  })

  test('unsupported Nuxt I18n routing strategy fails rather than projecting unverified paths', () => {
    expect(() => resolveLocalePolicy({
      nuxtI18n: { installed: true, locales: ['en', 'fr'], defaultLocale: 'en', strategy: 'prefix' },
      content: {},
      collections: []
    })).toThrow(/routing strategy "prefix" is not supported/)
  })

  test('default locale must be present in the resolved locales list', () => {
    expect(() => resolveLocalePolicy({
      nuxtI18n: { installed: false },
      content: { locales: ['en', 'de'], defaultLocale: 'fr' },
      collections: []
    })).toThrow(/is not present in the resolved locales list/)
  })
})

describe('resolveLocalePolicy — per-collection policy', () => {
  test('localized collections require a usable default locale', () => {
    expect(() => resolveLocalePolicy({
      nuxtI18n: { installed: false },
      content: {},
      collections: [{ name: 'docs', localized: true }]
    })).toThrow(/require a usable default locale/)
  })

  test('non-localized collections resolve an empty, non-localized policy', () => {
    const policy = resolveLocalePolicy({
      ...baseInput,
      collections: [{ name: 'posts', localized: false, route: '/posts' }]
    })
    expect(policy.collections.posts).toEqual({
      localized: false,
      locales: [],
      defaultLocale: undefined,
      fallback: {},
      translatedSlugs: false,
      routeMounts: { default: '/posts' }
    })
  })

  test('localized collections inherit the resolved global locale policy', () => {
    const policy = resolveLocalePolicy({
      ...baseInput,
      content: { ...baseInput.content, fallback: { de: ['en'] } }
    })
    expect(policy.collections.docs).toEqual({
      localized: true,
      locales: ['en', 'de'],
      defaultLocale: 'en',
      fallback: { de: ['en'] },
      translatedSlugs: false,
      // Localized collections carry a per-locale mount map, not a single `default` mount — the canonical route
      // projector consumes this directly.
      routeMounts: { en: '/docs', de: '/docs' }
    })
  })

  // Immutability is a type-level contract (`Readonly<...>`), not a runtime
  // `Object.freeze()` — the resolved policy is embedded by reference into
  // Nuxt/Nitro runtime config, and Nitro's own runtime-config normalization
  // recursively writes fallback defaults onto every nested object it walks.
  // A frozen policy would throw there regardless of environment, so
  // immutability is enforced by types/ownership discipline instead of a
  // runtime freeze that would break real builds.
  test('resolving the same input twice does not share mutable collection state', () => {
    const first = resolveLocalePolicy(baseInput)
    const second = resolveLocalePolicy(baseInput)
    expect(first).not.toBe(second)
    expect(first.collections.docs).not.toBe(second.collections.docs)
    expect(first).toEqual(second)
  })
})

describe('validateLocaleFallback', () => {
  const locales = ['en', 'de', 'de-AT']

  test('accepts a valid ordered fallback chain', () => {
    const result = validateLocaleFallback({ 'de-AT': ['de', 'en'] }, locales)
    expect(result).toEqual({ 'de-AT': ['de', 'en'] })
  })

  test('rejects an unknown fallback source locale', () => {
    expect(() => validateLocaleFallback({ fr: ['en'] }, locales)).toThrow(LocalePolicyError)
  })

  test('rejects an unknown fallback target locale', () => {
    expect(() => validateLocaleFallback({ de: ['fr'] }, locales)).toThrow(/unknown fallback target "fr"/)
  })

  test('rejects a locale falling back to itself (self-loop)', () => {
    expect(() => validateLocaleFallback({ de: ['de'] }, locales)).toThrow(/falls back to itself/)
  })

  test('rejects a fallback cycle', () => {
    expect(() => validateLocaleFallback({ en: ['de'], de: ['en'] }, locales)).toThrow(/contains a cycle/)
  })

  test('preserves declared fallback ordering exactly', () => {
    const result = validateLocaleFallback({ 'de-AT': ['de', 'en'] }, locales)
    expect(result['de-AT']).toEqual(['de', 'en'])
  })
})
