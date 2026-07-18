import { describe, expect, test, vi } from 'vitest'
import {
  LocalePolicyError,
  resolveLocalePolicy,
  validateLocaleFallback
} from '../../packages/content/src/features/localization/locale-policy'
import type { LocalePolicyInput } from '../../packages/content/src/features/localization/locale-policy'
import { resolveCollectionI18nConfig } from '../../packages/content/src/features/localization/config'
import { defineCollection, defineContentConfig } from '../../packages/content/src/types/config'
import { getCollectionPath } from '../../packages/content/src/features/query/routes'

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

  test('localized collections preserve their own locale set, default, fallback, and translated route mounts', () => {
    const policy = resolveLocalePolicy({
      ...baseInput,
      content: {
        ...baseInput.content,
        locales: ['en', 'de', 'fr'],
        fallback: { de: ['fr', 'en'], fr: ['en'] }
      },
      collections: [{
        name: 'docs',
        localized: true,
        locales: ['en', 'de'],
        defaultLocale: 'en',
        route: { en: '/docs', de: '/dokumentation' }
      }]
    })

    expect(policy.collections.docs).toEqual({
      localized: true,
      locales: ['en', 'de'],
      defaultLocale: 'en',
      fallback: { de: ['en'] },
      translatedSlugs: false,
      routeMounts: { en: '/docs', de: '/dokumentation' }
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

describe('collection locale configuration', () => {
  test('resolves collection i18n from the global content config by default', () => {
    expect(resolveCollectionI18nConfig({ source: 'authors/*.yml' }, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })).toEqual({
      defaultLocale: 'en',
      locales: ['en', 'de']
    })
  })

  test('prefers explicit per-collection i18n config', () => {
    expect(resolveCollectionI18nConfig({
      source: 'authors/*.yml',
      i18n: {
        defaultLocale: 'fr',
        locales: ['fr', 'en']
      }
    }, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })).toEqual({
      defaultLocale: 'fr',
      locales: ['fr', 'en']
    })
  })

  test('builds localized collection paths from collection route config', () => {
    const config = defineContentConfig({
      collections: {
        authors: defineCollection({
          type: 'data',
          source: 'authors/*.yml',
          route: {
            en: '/authors',
            de: '/autoren'
          },
          i18n: {
            defaultLocale: 'en',
            locales: ['en', 'de']
          }
        })
      }
    })
    const authors = config.collections.authors

    expect(getCollectionPath(authors, { slug: 'alexia', locale: 'en' })).toBe('/authors/alexia')
    expect(getCollectionPath(authors, { slug: 'alexia', locale: 'de' })).toBe('/de/autoren/alexia')
    expect(getCollectionPath(authors, { slug: ['team', 'alexia'], locale: 'de', canonical: true })).toBe('/autoren/team/alexia')
  })

  test('returns undefined for i18n shorthand without global config', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(resolveCollectionI18nConfig({
      source: 'authors/*.yml',
      i18n: true
    }, undefined, { warnMissingGlobal: true })).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('set i18n: true but no content.i18n config was found in nuxt.config.ts'))
    warn.mockRestore()
  })
})
