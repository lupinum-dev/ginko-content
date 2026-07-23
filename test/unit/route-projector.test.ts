import { describe, expect, test } from 'vitest'
import type { ResolvedCollectionLocalePolicy } from '../../packages/content/src/features/localization/locale-policy'
import {
  RouteProjectionError,
  buildRouteRecords,
  lowerRouteToCandidates,
  projectContentRoute,
  resolveContentRoute,
  synthesizeAlternates,
  type ContentProviderRouteFact,
  type ContentProviderVariantFact
} from '../../packages/content/src/features/localization/route-projector'

/**
 * Unit tests for the canonical route projector/resolver/alternate
 * synthesizer. Pure functions — no Nuxt
 * instance, no filesystem.
 */

const policy: ResolvedCollectionLocalePolicy = {
  localized: true,
  locales: ['en', 'de', 'fr'],
  defaultLocale: 'en',
  fallback: {
    de: ['en'],
    fr: ['de', 'en']
  },
  translatedSlugs: false,
  routeMounts: { en: '/docs', de: '/docs', fr: '/docs' }
}

const translatedPolicy: ResolvedCollectionLocalePolicy = {
  ...policy,
  routeMounts: { en: '/guide', de: '/anleitung', fr: '/guide-fr' }
}

describe('projectContentRoute', () => {
  test('default locale gets no prefix', () => {
    expect(projectContentRoute({ contentPath: '/intro', locale: 'en' }, policy)).toBe('/docs/intro')
  })

  test('non-default locale gets a locale prefix', () => {
    expect(projectContentRoute({ contentPath: '/intro', locale: 'de' }, policy)).toBe('/de/docs/intro')
  })

  test('translated route mounts project per locale', () => {
    expect(projectContentRoute({ contentPath: '/intro', locale: 'en' }, translatedPolicy)).toBe('/guide/intro')
    expect(projectContentRoute({ contentPath: '/intro', locale: 'de' }, translatedPolicy)).toBe('/de/anleitung/intro')
  })

  test('treats the root mount as no added path segment', () => {
    const rootPolicy: ResolvedCollectionLocalePolicy = {
      ...policy,
      routeMounts: { en: '/', de: '/', fr: '/' }
    }
    expect(projectContentRoute({ contentPath: '/intro', locale: 'en' }, rootPolicy)).toBe('/intro')
    expect(projectContentRoute({ contentPath: '/intro', locale: 'de' }, rootPolicy)).toBe('/de/intro')
    expect(lowerRouteToCandidates('/de/intro', rootPolicy, 'de')).toEqual([
      { locale: 'de', contentPath: '/intro' },
      { locale: 'en', contentPath: '/intro' }
    ])
  })
})

describe('lowerRouteToCandidates', () => {
  test('produces ordered candidates using the fallback chain', () => {
    const candidates = lowerRouteToCandidates('/fr/docs/intro', policy, 'fr')
    expect(candidates.map(candidate => candidate.locale)).toEqual(['fr', 'de', 'en'])
    for (const candidate of candidates) {
      expect(candidate.contentPath).toBe('/intro')
    }
  })
})

describe('buildRouteRecords', () => {
  const facts: ContentProviderRouteFact[] = [
    { collection: 'docs', canonicalKey: 'intro', locale: 'en', contentPath: '/intro' },
    { collection: 'docs', canonicalKey: 'intro', locale: 'de', contentPath: '/intro' }
  ]

  test('produces deterministic, sorted route records', () => {
    const { records } = buildRouteRecords(facts, policy)
    expect(records).toEqual([
      { collection: 'docs', canonicalKey: 'intro', locale: 'de', contentPath: '/intro', path: '/de/docs/intro', draft: false, sitemap: true },
      { collection: 'docs', canonicalKey: 'intro', locale: 'en', contentPath: '/intro', path: '/docs/intro', draft: false, sitemap: true }
    ])
  })

  test('excludes navigation-file facts', () => {
    const { records } = buildRouteRecords(
      [...facts, { collection: 'docs', canonicalKey: 'nav', locale: 'en', contentPath: '/_dir', navigationFile: true }],
      policy
    )
    expect(records.some(record => record.canonicalKey === 'nav')).toBe(false)
  })

  test('duplicate/ambiguous projected paths raise a diagnostic with both identities and the path', () => {
    const colliding: ContentProviderRouteFact[] = [
      { collection: 'docs', canonicalKey: 'a', locale: 'en', contentPath: '/intro' },
      { collection: 'docs', canonicalKey: 'b', locale: 'en', contentPath: '/intro' }
    ]
    expect(() => buildRouteRecords(colliding, policy)).toThrow(RouteProjectionError)
    try {
      buildRouteRecords(colliding, policy)
      expect.unreachable()
    } catch (error) {
      expect(String(error)).toMatch(/"a"/)
      expect(String(error)).toMatch(/"b"/)
      expect(String(error)).toMatch('/docs/intro')
    }
  })
})

describe('resolveContentRoute — real resolver round trip', () => {
  test('every projected path resolves back to its originating canonicalKey', () => {
    const facts: ContentProviderRouteFact[] = [
      { collection: 'docs', canonicalKey: 'intro', locale: 'en', contentPath: '/intro' },
      { collection: 'docs', canonicalKey: 'intro', locale: 'de', contentPath: '/intro' },
      { collection: 'docs', canonicalKey: 'setup', locale: 'en', contentPath: '/setup' }
    ]
    const { records, index } = buildRouteRecords(facts, policy)
    for (const record of records) {
      const resolved = resolveContentRoute(record.path, record.locale, policy, index)
      expect(resolved?.canonicalKey).toBe(record.canonicalKey)
    }
  })

  test('an unknown path resolves to nothing', () => {
    const { index } = buildRouteRecords(
      [{ collection: 'docs', canonicalKey: 'intro', locale: 'en', contentPath: '/intro' }],
      policy
    )
    expect(resolveContentRoute('/docs/missing', 'en', policy, index)).toBeUndefined()
  })
})

describe('synthesizeAlternates', () => {
  const variants: ContentProviderVariantFact[] = [
    { collection: 'docs', canonicalKey: 'intro', locale: 'en', contentPath: '/intro' }
  ]

  test('concrete variants only — no configured locales beyond the variant, no fallback entries', () => {
    const soloPolicy: ResolvedCollectionLocalePolicy = { ...policy, locales: ['en'], fallback: {} }
    const { index } = buildRouteRecords(variants, soloPolicy)
    const alternates = synthesizeAlternates('intro', variants, soloPolicy, index)
    expect(alternates).toEqual([
      { collection: 'docs', canonicalKey: 'intro', locale: 'en', path: '/docs/intro', source: 'variant' }
    ])
  })

  test('one-hop fallback: de falls back to en', () => {
    const { index } = buildRouteRecords(variants, policy)
    const alternates = synthesizeAlternates('intro', variants, policy, index)
    const de = alternates.find(alt => alt.locale === 'de')
    expect(de).toEqual({
      collection: 'docs',
      canonicalKey: 'intro',
      locale: 'de',
      path: '/de/docs/intro',
      source: 'fallback',
      resolvedLocale: 'en'
    })
  })

  test('multi-hop, ordered fallback chain: fr falls back through de to en when neither de nor fr is concrete', () => {
    const { index } = buildRouteRecords(variants, policy)
    const alternates = synthesizeAlternates('intro', variants, policy, index)
    const fr = alternates.find(alt => alt.locale === 'fr')
    expect(fr?.resolvedLocale).toBe('en')
  })

  test('multi-hop fallback prefers the first available chain member (de before en) when both exist', () => {
    const withDe: ContentProviderVariantFact[] = [
      ...variants,
      { collection: 'docs', canonicalKey: 'intro', locale: 'de', contentPath: '/intro' }
    ]
    const { index } = buildRouteRecords(withDe, policy)
    const alternates = synthesizeAlternates('intro', withDe, policy, index)
    const fr = alternates.find(alt => alt.locale === 'fr')
    expect(fr?.resolvedLocale).toBe('de')
  })

  test('translated route mounts: fallback alternate projects into the target locale mount', () => {
    const { index } = buildRouteRecords(variants, translatedPolicy)
    const alternates = synthesizeAlternates('intro', variants, translatedPolicy, index)
    const de = alternates.find(alt => alt.locale === 'de')
    expect(de?.path).toBe('/de/anleitung/intro')
  })

  test('disabled fallback: no fallback alternates are emitted', () => {
    const { index } = buildRouteRecords(variants, policy)
    const alternates = synthesizeAlternates('intro', variants, policy, index, { allowFallback: false })
    expect(alternates).toEqual([
      { collection: 'docs', canonicalKey: 'intro', locale: 'en', path: '/docs/intro', source: 'variant' }
    ])
  })

  test('missing source variant: a locale whose whole fallback chain is empty of concrete variants gets no alternate', () => {
    const isolatedPolicy: ResolvedCollectionLocalePolicy = { ...policy, fallback: { de: [], fr: [] } }
    const { index } = buildRouteRecords(variants, isolatedPolicy)
    const alternates = synthesizeAlternates('intro', variants, isolatedPolicy, index)
    expect(alternates.map(alt => alt.locale)).toEqual(['en'])
  })

  test('candidate resolving to another canonical key is not emitted', () => {
    // "setup" already owns /de/docs/setup for locale de. "intro" falling back
    // to en would only collide if its candidate path matched another
    // document's real path — construct that collision directly.
    const collidingVariants: ContentProviderVariantFact[] = [
      { collection: 'docs', canonicalKey: 'intro', locale: 'en', contentPath: '/setup' },
      { collection: 'docs', canonicalKey: 'setup', locale: 'de', contentPath: '/setup' }
    ]
    const { index } = buildRouteRecords(collidingVariants, policy)
    const alternates = synthesizeAlternates('intro', collidingVariants, policy, index)
    // "intro"'s de fallback candidate path (/de/docs/setup) resolves to
    // canonicalKey "setup", not "intro" — so no fallback alternate for de.
    expect(alternates.some(alt => alt.locale === 'de')).toBe(false)
  })

  test('deterministic locale order matches policy.locales order', () => {
    const { index } = buildRouteRecords(variants, policy)
    const alternates = synthesizeAlternates('intro', variants, policy, index)
    expect(alternates.map(alt => alt.locale)).toEqual(['en', 'de', 'fr'])
  })

  test('resolvedLocale appears only on fallback entries', () => {
    const { index } = buildRouteRecords(variants, policy)
    const alternates = synthesizeAlternates('intro', variants, policy, index)
    for (const alt of alternates) {
      if (alt.source === 'variant') {
        expect(alt.resolvedLocale).toBeUndefined()
      } else {
        expect(alt.resolvedLocale).toBeDefined()
      }
    }
  })

  test('resolver round trip: every alternate path resolves back to the originating canonicalKey', () => {
    const { index } = buildRouteRecords(variants, policy)
    const alternates = synthesizeAlternates('intro', variants, policy, index)
    for (const alt of alternates) {
      const resolved = resolveContentRoute(alt.path, alt.locale, policy, index)
      expect(resolved?.canonicalKey).toBe('intro')
    }
  })
})

describe('lowerRouteToCandidates — non-localized branch is mount-agnostic', () => {
  test('strips the collection mount just like the localized branch', () => {
    const nonLocalizedPolicy: ResolvedCollectionLocalePolicy = {
      localized: false,
      locales: [],
      fallback: {},
      translatedSlugs: false,
      routeMounts: { default: '/blog' }
    }
    const candidates = lowerRouteToCandidates('/blog/post', nonLocalizedPolicy)
    expect(candidates).toEqual([{ locale: '', contentPath: '/post' }])
  })
})

describe('integration round trip — real ginko-i18n translated-slug fixture', () => {
  // Mirrors playground/ginko-i18n/content.config.ts ("docs" collection:
  // route: { en: '/guide', de: '/leitfaden' }, i18n: true, translatedSlugs:
  // true) and the real translated-slug pair on disk:
  //   content/en/1.guide/1.getting-started.md  (ref: guide-getting-started)
  //   content/de/1.leitfaden/1.erste-schritte.md
  // Both files share one canonical key across locales despite their content
  // paths (translated slugs) differing per locale — exactly the "stable
  // canonical key across translated slugs" the English fixture doc describes.
  const ginkoI18nDocsPolicy: ResolvedCollectionLocalePolicy = {
    localized: true,
    locales: ['en', 'de'],
    defaultLocale: 'en',
    fallback: { de: ['en'] },
    translatedSlugs: true,
    routeMounts: { en: '/guide', de: '/leitfaden' }
  }

  const translatedSlugVariants: ContentProviderVariantFact[] = [
    { collection: 'docs', canonicalKey: 'guide/getting-started', locale: 'en', contentPath: '/getting-started' },
    { collection: 'docs', canonicalKey: 'guide/getting-started', locale: 'de', contentPath: '/erste-schritte' }
  ]

  test('projects each variant to its real, mount-translated public path', () => {
    const [en, de] = translatedSlugVariants
    expect(projectContentRoute(en!, ginkoI18nDocsPolicy)).toBe('/guide/getting-started')
    expect(projectContentRoute(de!, ginkoI18nDocsPolicy)).toBe('/de/leitfaden/erste-schritte')
  })

  test('synthesizeAlternates output resolves each alternate back to the originating canonicalKey', () => {
    const { index } = buildRouteRecords(translatedSlugVariants, ginkoI18nDocsPolicy)
    const alternates = synthesizeAlternates('guide/getting-started', translatedSlugVariants, ginkoI18nDocsPolicy, index)

    // Both locales have concrete variants, so both alternates are 'variant'
    // sourced (no fallback needed) and each must round-trip through the real
    // resolver back to the same canonicalKey.
    expect(alternates).toHaveLength(2)
    for (const alt of alternates) {
      expect(alt.source).toBe('variant')
      const resolved = resolveContentRoute(alt.path, alt.locale, ginkoI18nDocsPolicy, index)
      expect(resolved?.canonicalKey).toBe('guide/getting-started')
    }

    const en = alternates.find(alt => alt.locale === 'en')
    const de = alternates.find(alt => alt.locale === 'de')
    expect(en?.path).toBe('/guide/getting-started')
    expect(de?.path).toBe('/de/leitfaden/erste-schritte')
  })

  test('a de-only variant falls back to en, still projected through the de mount, and resolves back to the same key', () => {
    const deOnly: ContentProviderVariantFact[] = [translatedSlugVariants[0]!]
    const { index } = buildRouteRecords(deOnly, ginkoI18nDocsPolicy)
    const alternates = synthesizeAlternates('guide/getting-started', deOnly, ginkoI18nDocsPolicy, index)
    const de = alternates.find(alt => alt.locale === 'de')
    // Fallback alternates project the SOURCE variant's (en) untranslated
    // contentPath through the REQUESTED locale's (de) own mount -- the
    // mount is a property of the target locale, not of the source content.
    expect(de).toEqual({
      collection: 'docs',
      canonicalKey: 'guide/getting-started',
      locale: 'de',
      path: '/de/leitfaden/getting-started',
      source: 'fallback',
      resolvedLocale: 'en'
    })
    const resolved = resolveContentRoute(de!.path, de!.locale, ginkoI18nDocsPolicy, index)
    expect(resolved?.canonicalKey).toBe('guide/getting-started')
  })
})

describe('benchmark: 1,000 documents, several locales, multi-hop fallback', () => {
  test('projection + alternate synthesis stays well within a generous wall-time budget', () => {
    const benchPolicy: ResolvedCollectionLocalePolicy = {
      localized: true,
      locales: ['en', 'de', 'fr', 'es'],
      defaultLocale: 'en',
      fallback: { de: ['en'], fr: ['de', 'en'], es: ['fr', 'de', 'en'] },
      translatedSlugs: false,
      routeMounts: { en: '/docs', de: '/docs', fr: '/docs', es: '/docs' }
    }

    const documentCount = 1000
    const allVariants: ContentProviderRouteFact[] = []
    for (let i = 0; i < documentCount; i++) {
      // Every third document only has an English source, forcing fallback
      // walks for the rest of its locales.
      const locales = i % 3 === 0 ? ['en'] : ['en', 'de']
      for (const locale of locales) {
        allVariants.push({
          collection: 'docs',
          canonicalKey: `doc-${i}`,
          locale,
          contentPath: `/doc-${i}`
        })
      }
    }

    const start = performance.now()
    const { index } = buildRouteRecords(allVariants, benchPolicy)
    const byCanonicalKey = new Map<string, ContentProviderVariantFact[]>()
    for (const variant of allVariants) {
      const list = byCanonicalKey.get(variant.canonicalKey) ?? []
      list.push(variant)
      byCanonicalKey.set(variant.canonicalKey, list)
    }
    let alternateCount = 0
    for (const [canonicalKey, variants] of byCanonicalKey) {
      alternateCount += synthesizeAlternates(canonicalKey, variants, benchPolicy, index).length
    }
    const elapsedMs = performance.now() - start

    expect(alternateCount).toBeGreaterThan(documentCount)
    // Generous, honest bound: this is O(documents x locales x fallback-chain
    // length) work, not quadratic. A regression to quadratic behavior would
    // blow well past this on 1,000 documents.
    expect(elapsedMs).toBeLessThan(2000)
  })
})
