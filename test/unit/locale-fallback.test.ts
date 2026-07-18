import { describe, expect, test, vi } from 'vitest'
import { buildContentGraph } from '../../packages/content/src/core/content/graph'
import {
  buildLocaleFallbackChain,
  expandDataLocaleVariants,
  resolveLocaleChain,
  splitInlineLocaleVariantId
} from '../../packages/content/src/core/content/locale'
import { executeQueryPlan } from '../../packages/content/src/core/query/execute'
import { lowerQueryPlan } from '../../packages/content/src/core/query/lower'
import { normalizeContentQueryParams } from '../../packages/content/src/core/query/params'
import { buildContentAlternates } from '../../packages/content/src/features/localization/results'
import type { ParsedContent } from '../../packages/content/src/types/content'

/**
 * The locale fallback chain executes against a real
 * graph built by `buildContentGraph` — `resolveLocaleChain` is NOT mocked here
 * (the query-contracts suite keeps its own mock for a different purpose). The
 * chain under test is `de-AT → de → en`, exercised through `executeQueryPlan`'s
 * variant resolver.
 */

const LOCALES = ['de-AT', 'de', 'en']
const DEFAULT_LOCALE = 'en'
// Configured fallback: de-AT falls back through de before the default en.
const LOCALE_FALLBACK = { 'de-AT': ['de'] }

const variant = (
  canonicalKey: string,
  path: string,
  locale: string
): ParsedContent => ({
  id: `content:${locale}:${canonicalKey}.md`,
  path,
  file: { source: 'content', path: `/${locale}${path}.md`, extension: 'md' },
  type: 'markdown',
  locale,
  canonicalKey,
  collection: 'docs',
  title: `${canonicalKey} (${locale})`,
  body: { type: 'root', children: [] }
}) as unknown as ParsedContent

// Non-translated slugs: every locale variant of a canonical key shares its
// route path, so `byRoute` finds the key and the locale chain then picks the
// variant. Coverage:
//   guide/intro — all three locales (exact requested locale is present)
//   guide/deep  — de + en only (requested head de-AT missing → one-step fallback)
//   guide/solo  — en only (both de-AT and the intermediate de missing → full skip)
const graph = buildContentGraph([
  variant('guide/intro', '/guide/intro', 'de-AT'),
  variant('guide/intro', '/guide/intro', 'de'),
  variant('guide/intro', '/guide/intro', 'en'),
  variant('guide/deep', '/guide/deep', 'de'),
  variant('guide/deep', '/guide/deep', 'en'),
  variant('guide/solo', '/guide/solo', 'en')
], { locales: LOCALES, defaultLocale: DEFAULT_LOCALE })

const resolveVariant = (path: string, locale: string) => {
  const plan = lowerQueryPlan({ collection: 'docs', first: true, resolveVariant: { path, locale } } as never)
  const response = executeQueryPlan<ParsedContent>(graph, plan, {
    defaultLocale: DEFAULT_LOCALE,
    localeFallback: LOCALE_FALLBACK
  })
  return response.result as (ParsedContent & { resolved?: Record<string, unknown> }) | undefined
}

describe('locale fallback chain (unmocked, real graph)', () => {
  test('resolveLocaleChain builds the de-AT → de → en chain', () => {
    expect(resolveLocaleChain('de-AT', DEFAULT_LOCALE, LOCALE_FALLBACK)).toEqual(['de-AT', 'de', 'en'])
    // No configured fallback for `de`: chain is just [de, en].
    expect(resolveLocaleChain('de', DEFAULT_LOCALE, {})).toEqual(['de', 'en'])
    expect(resolveLocaleChain(undefined, DEFAULT_LOCALE, {})).toEqual(['en'])
  })

  test('requested locale present → exact resolution, no fallback', () => {
    const result = resolveVariant('/guide/intro', 'de-AT')
    expect(result?.locale).toBe('de-AT')
    expect(result?.resolved).toMatchObject({
      requestedLocale: 'de-AT',
      locale: 'de-AT',
      fallback: false
    })
  })
})

describe('inline data locale variants', () => {
  test('builds locale fallback chains without duplicates', () => {
    expect(buildLocaleFallbackChain('de', 'en', { de: ['fr', 'en'] })).toEqual(['fr', 'en'])
    expect(buildLocaleFallbackChain('en', 'en', { en: ['fr'] })).toEqual(['fr'])
    expect(buildLocaleFallbackChain('de', undefined, undefined)).toEqual([])
  })

  test('splits inline locale variant ids safely', () => {
    expect(splitInlineLocaleVariantId('content:authors:evan.yml')).toEqual({
      sourceId: 'content:authors:evan.yml',
      locale: undefined
    })
    expect(splitInlineLocaleVariantId('content:authors:evan.yml#__locale=de')).toEqual({
      sourceId: 'content:authors:evan.yml',
      locale: 'de'
    })
    expect(splitInlineLocaleVariantId('content:authors:evan.yml#__locale=')).toEqual({
      sourceId: 'content:authors:evan.yml',
      locale: undefined
    })
  })

  test('expands inline data locale variants with deep object merge and array replacement', () => {
    const variants = expandDataLocaleVariants({
      id: 'content:authors:evan.yml',
      path: '/authors/evan',
      file: { path: 'authors/evan.yml' },
      collection: 'authors',
      type: 'yaml',
      locale: 'en',
      canonicalKey: 'authors/evan',
      body: null,
      name: 'Evan You',
      profile: {
        focus: 'DX',
        labels: ['default']
      },
      i18n: {
        de: {
          profile: {
            labels: ['de']
          }
        }
      }
    } as any, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })

    expect(variants).toHaveLength(2)
    expect(variants[1]).toMatchObject({
      id: 'content:authors:evan.yml#__locale=de',
      locale: 'de',
      profile: {
        focus: 'DX',
        labels: ['de']
      }
    })
  })

  test('merges own __proto__ locale override data without changing variant prototypes', () => {
    const override = JSON.parse('{"__proto__":{"source":"de"}}')
    const variants = expandDataLocaleVariants({
      id: 'content:authors:evan.json',
      collection: 'authors',
      type: 'json',
      locale: 'en',
      body: null,
      i18n: { de: override }
    } as any, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })
    const german = variants[1] as Record<string, unknown>

    expect(Object.getPrototypeOf(german)).toBe(Object.prototype)
    expect(Object.hasOwn(german, '__proto__')).toBe(true)
    expect(german.__proto__).toEqual({ source: 'de' })
  })

  test('keeps data documents unchanged when inline i18n is empty or locale override matches source locale', () => {
    expect(expandDataLocaleVariants({
      id: 'content:authors:evan.yml',
      type: 'yaml',
      locale: 'en',
      body: null,
      i18n: {}
    } as any, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })).toHaveLength(1)

    expect(expandDataLocaleVariants({
      id: 'content:authors:evan.yml',
      type: 'json',
      body: null,
      i18n: {
        en: {
          name: 'Evan You'
        }
      }
    } as any, {
      defaultLocale: 'en',
      locales: ['en']
    })).toHaveLength(1)
  })

  test('expands data variants even when the source document has no explicit locale', () => {
    const variants = expandDataLocaleVariants({
      id: 'content:authors:evan.yml',
      type: 'json',
      body: null,
      name: 'Evan You',
      i18n: {
        de: {
          name: 'Evan You DE'
        }
      }
    } as any, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })

    expect(variants.map(variant => variant.locale)).toEqual(['en', 'de'])
  })

  test('warns and skips non-object inline locale overrides', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const variants = expandDataLocaleVariants({
      id: 'content:authors:evan.yml',
      type: 'yaml',
      locale: 'en',
      body: null,
      i18n: {
        de: 'not-an-object'
      }
    } as any, {
      defaultLocale: 'en',
      locales: ['en', 'de']
    })

    expect(variants).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('must be an object. Skipping invalid override'))
    warn.mockRestore()
  })
})

describe('locale fallback execution and result shaping', () => {
  test('missing head → one-step fallback to the next chain locale', () => {
    const result = resolveVariant('/guide/deep', 'de-AT')
    expect(result?.locale).toBe('de')
    expect(result?.resolved).toMatchObject({
      requestedLocale: 'de-AT',
      locale: 'de',
      fallback: true
    })
  })

  test('missing intermediate → walk the full chain to the default locale', () => {
    const result = resolveVariant('/guide/solo', 'de-AT')
    expect(result?.locale).toBe('en')
    expect(result?.resolved).toMatchObject({
      requestedLocale: 'de-AT',
      locale: 'en',
      fallback: true
    })
  })

  test('explicit empty fallback keeps list and path resolution exact', () => {
    const options = {
      collectionI18n: { locales: LOCALES, defaultLocale: DEFAULT_LOCALE },
      defaultLocale: DEFAULT_LOCALE,
      localeFallback: LOCALE_FALLBACK
    }
    const execute = (params: Record<string, unknown>) => executeQueryPlan<ParsedContent>(
      graph,
      lowerQueryPlan(normalizeContentQueryParams(params as never, options)),
      {
        defaultLocale: DEFAULT_LOCALE,
        localeFallback: LOCALE_FALLBACK,
        collections: { docs: { i18n: options.collectionI18n } }
      }
    )

    expect(execute({
      collection: 'docs',
      resolveLocale: { locale: 'de-AT', fallback: [] }
    }).result).toEqual([
      expect.objectContaining({ canonicalKey: 'guide/intro', locale: 'de-AT' })
    ])
    expect(execute({
      collection: 'docs',
      first: true,
      resolveVariant: { path: '/guide/solo', locale: 'de-AT', fallback: [] }
    }).result).toBeUndefined()
  })

  test.each(['path', 'route', 'ref'] as const)('explicit fallback does not append the default locale for %s lookup', (selector) => {
    const selectorValue = selector === 'ref' ? 'guide/solo' : '/guide/solo'
    const params = normalizeContentQueryParams({
      collection: 'docs',
      first: true,
      resolveVariant: { [selector]: selectorValue, locale: 'de-AT', fallback: ['fr'] }
    } as never, {
      collectionI18n: { locales: [...LOCALES, 'fr'], defaultLocale: DEFAULT_LOCALE },
      defaultLocale: DEFAULT_LOCALE,
      localeFallback: LOCALE_FALLBACK
    })
    const response = executeQueryPlan<ParsedContent>(graph, lowerQueryPlan(params), {
      defaultLocale: DEFAULT_LOCALE,
      localeFallback: LOCALE_FALLBACK,
      collections: { docs: { i18n: { locales: [...LOCALES, 'fr'], defaultLocale: DEFAULT_LOCALE } } }
    })

    expect(response.result).toBeUndefined()
  })

  test('explicit list fallback does not append the default locale', () => {
    const params = normalizeContentQueryParams({
      collection: 'docs',
      resolveLocale: { locale: 'fr', fallback: ['de-AT'] }
    }, {
      collectionI18n: { locales: [...LOCALES, 'fr'], defaultLocale: DEFAULT_LOCALE },
      defaultLocale: DEFAULT_LOCALE,
      localeFallback: { fr: ['en'] }
    })
    const response = executeQueryPlan<ParsedContent>(graph, lowerQueryPlan(params), {
      defaultLocale: DEFAULT_LOCALE,
      localeFallback: { fr: ['en'] },
      collections: { docs: { i18n: { locales: [...LOCALES, 'fr'], defaultLocale: DEFAULT_LOCALE } } }
    })

    expect((response.result as ParsedContent[]).every(document => document.locale === 'de-AT')).toBe(true)
    expect((response.result as ParsedContent[]).some(document => document.locale === 'en')).toBe(false)
  })

  test('locale list queries carry every concrete variant path into document shaping', () => {
    const plan = lowerQueryPlan({
      collection: 'docs',
      resolveLocale: { locale: 'de-AT' }
    } as never)
    const response = executeQueryPlan<ParsedContent>(graph, plan, {
      defaultLocale: DEFAULT_LOCALE,
      localeFallback: LOCALE_FALLBACK,
      collections: {
        docs: { i18n: { locales: LOCALES, defaultLocale: DEFAULT_LOCALE } }
      }
    })
    const deep = (response.result as ParsedContent[]).find(document => document.canonicalKey === 'guide/deep')

    expect(deep?.resolved?.variantPaths).toEqual({
      de: '/guide/deep',
      en: '/guide/deep'
    })
  })

  test('document shaping hides draft sibling routes outside preview', () => {
    const visibilityGraph = buildContentGraph([
      variant('guide/preview', '/guide/preview', 'en'),
      { ...variant('guide/preview', '/guide/vorschau', 'de'), draft: true }
    ], { locales: ['en', 'de'], defaultLocale: 'en' })
    const plan = lowerQueryPlan({
      collection: 'docs',
      resolveLocale: { locale: 'en' }
    } as never)
    const options = {
      defaultLocale: 'en',
      localeFallback: { de: ['en'] },
      collections: {
        docs: { i18n: { locales: ['en', 'de'], defaultLocale: 'en' } }
      }
    }

    const published = executeQueryPlan<ParsedContent>(visibilityGraph, plan, {
      ...options,
      includeDrafts: false
    })
    const preview = executeQueryPlan<ParsedContent>(visibilityGraph, plan, {
      ...options,
      includeDrafts: true
    })

    expect((published.result as ParsedContent[])[0]?.resolved?.variantPaths).toEqual({
      en: '/guide/preview'
    })
    expect((preview.result as ParsedContent[])[0]?.resolved?.variantPaths).toEqual({
      en: '/guide/preview',
      de: '/guide/vorschau'
    })

    const routePlan = lowerQueryPlan({
      collection: 'docs',
      first: true,
      resolveVariant: { path: '/guide/preview', locale: 'en' }
    } as never)
    const publishedRoute = executeQueryPlan<ParsedContent>(visibilityGraph, routePlan, {
      ...options,
      includeDrafts: false
    })
    const previewRoute = executeQueryPlan<ParsedContent>(visibilityGraph, routePlan, {
      ...options,
      includeDrafts: true
    })

    expect((publishedRoute.result as ParsedContent).resolved?.variantPaths).toEqual({
      en: '/guide/preview'
    })
    expect((previewRoute.result as ParsedContent).resolved?.variantPaths).toEqual({
      en: '/guide/preview',
      de: '/guide/vorschau'
    })
  })

  test('document alternates never guess fallback routes for unrequested locales', () => {
    expect(buildContentAlternates(
      { en: '/guide/solo' },
      'en',
      'en',
      ['en', 'de'],
      { en: '/guide', de: '/leitfaden' }
    )).toEqual([
      { locale: 'en', path: '/guide/solo', source: 'variant' }
    ])
  })

  test('document alternates include the fallback route proven by the current resolution', () => {
    expect(buildContentAlternates(
      { en: '/guide/solo' },
      'en',
      'en',
      ['en', 'de'],
      { en: '/guide', de: '/leitfaden' },
      'de',
      '/de/leitfaden/solo'
    )).toEqual([
      { locale: 'en', path: '/guide/solo', source: 'variant' },
      { locale: 'de', path: '/de/leitfaden/solo', source: 'fallback', resolvedLocale: 'en' }
    ])
  })

  test('a concrete requested-locale variant prevents a duplicate fallback entry', () => {
    expect(buildContentAlternates(
      { en: '/guide/intro', de: '/leitfaden/einstieg' },
      'en',
      'en',
      ['en', 'de'],
      { en: '/guide', de: '/leitfaden' },
      'de',
      '/de/leitfaden/einstieg'
    )).toEqual([
      { locale: 'en', path: '/guide/intro', source: 'variant' },
      { locale: 'de', path: '/de/leitfaden/einstieg', source: 'variant' }
    ])
  })

  test('a fallback route is omitted when the resolved source variant is absent', () => {
    expect(buildContentAlternates(
      undefined,
      'en',
      'en',
      ['en', 'de'],
      { en: '/guide', de: '/leitfaden' },
      'de',
      '/de/leitfaden/solo'
    )).toEqual([])
  })

})
