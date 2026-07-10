import { describe, expect, test } from 'vitest'
import { transformContent } from '../../packages/content/src/parsers/index'
import type { ContentTransformer, ParsedContent } from '../../packages/content/src/types/content'
import { buildRouteRecords, resolveContentRoute, synthesizeAlternates } from '../../packages/content/src/features/localization/route-projector'
import type { ContentProviderRouteFact } from '../../packages/content/src/features/localization/route-projector'
import type { ResolvedCollectionLocalePolicy } from '../../packages/content/src/features/localization/locale-policy'

// VNEXT.md 20.1 -- route/build invariant fixture (§20.1) and 32.1 test-ownership
// table. The real, end-to-end proof for most of these invariants is the live
// `nuxi generate` run in test/e2e/generate-output.test.ts against
// test/fixtures/vnext-route-invariants (module setup, translated numeric
// slugs, missing-translation fallback, draft/partial/navigation-control/data
// exclusion, sitemap opt-out vs. prerender decoupling, the
// `content:file:beforeParse` hook effect, the real `content.transformers`
// wiring's effect, and the cross-artifact golden). This file covers
// invariants that are cleaner to prove as narrow units: a custom
// transformer's effect on a parsed document, and alternate round-trip
// identity.

const wordCountTransformer: ContentTransformer = {
  name: 'word-count',
  extensions: ['.md'],
  transform (content: ParsedContent) {
    const body = (content as { body?: { children?: unknown[] } }).body
    const collectText = (node: unknown, out: string[] = []): string[] => {
      if (!node || typeof node !== 'object') return out
      const { type, value, children } = node as { type?: string, value?: unknown, children?: unknown[] }
      if (type === 'text' && typeof value === 'string') out.push(value)
      if (Array.isArray(children)) for (const child of children) collectText(child, out)
      return out
    }
    const words = collectText(body).join(' ').trim().split(/\s+/).filter(Boolean)
    return { ...content, wordCount: words.length }
  }
}

describe('vNext route invariants contracts', () => {
  test('a custom transformer registered via transformContent options stamps a computed fact identically on every parse', async () => {
    const markdown = [
      '---',
      'title: Sample',
      '---',
      '',
      '# Sample',
      '',
      'four words here total'
    ].join('\n')

    const first = await transformContent('content:en:guide:sample.md', markdown, {
      transformers: [wordCountTransformer]
    })
    const second = await transformContent('content:en:guide:sample.md', markdown, {
      transformers: [wordCountTransformer]
    })

    expect((first as { wordCount?: number }).wordCount).toBeGreaterThan(0)
    expect((first as { wordCount?: number }).wordCount).toBe((second as { wordCount?: number }).wordCount)
  })

  // Real fixture-level proof of the same transformer primitive: the
  // `test/fixtures/vnext-route-invariants` fixture now registers
  // `transformers/word-count.ts` through a real `content.transformers`
  // nuxt.config entry (`ModuleOptions.transformers`, wired in
  // `packages/content/src/module.ts`) instead of only exercising
  // `transformContent` directly above. `test/e2e/generate-output.test.ts`
  // asserts its computed `wordCount` fact appears identically through a
  // direct query (/nav) and the transformed page's own generated route —
  // the same parity invariant already proven for `content:file:beforeParse`.

  test('alternates synthesized for a canonical document round-trip back to the SAME canonical key (VNEXT 12.3, 20.3)', () => {
    // Mirrors the fixture's own translated-slug/fallback shape: `docs`
    // mounted at `/guide` (en) / `/leitfaden` (de), `en` default, `de` falls
    // back to `en` when a locale variant is missing.
    const policy: ResolvedCollectionLocalePolicy = {
      localized: true,
      locales: ['en', 'de'],
      defaultLocale: 'en',
      fallback: { de: ['en'] },
      translatedSlugs: true,
      routeMounts: { en: '/guide', de: '/leitfaden' }
    }
    const facts: ContentProviderRouteFact[] = [
      { collection: 'docs', canonicalKey: 'docs/getting-started', locale: 'en', contentPath: '/getting-started' },
      { collection: 'docs', canonicalKey: 'docs/getting-started', locale: 'de', contentPath: '/getting-started' },
      // `docs/advanced-en-only` has no concrete `de` variant, so `de`
      // resolves through the fallback chain to the `en` source content.
      { collection: 'docs', canonicalKey: 'docs/advanced-en-only', locale: 'en', contentPath: '/advanced-en-only' }
    ]

    const { index } = buildRouteRecords(facts, policy)

    // Every alternate, including a synthesized fallback URL, must resolve
    // through the canonical policy-aware resolver to the same identity.
    for (const canonicalKey of ['docs/getting-started', 'docs/advanced-en-only']) {
      const alternates = synthesizeAlternates(canonicalKey, facts, policy, index)
      expect(alternates.length).toBeGreaterThan(0)
      for (const alternate of alternates) {
        const resolved = resolveContentRoute(alternate.path, alternate.locale, policy, index)
        expect(resolved?.canonicalKey, `alternate ${alternate.locale} ${alternate.path} must round-trip to ${canonicalKey}`).toBe(canonicalKey)
      }
    }

    const fallbackAlternate = synthesizeAlternates('docs/advanced-en-only', facts, policy, index)
      .find(alternate => alternate.locale === 'de')
    expect(fallbackAlternate).toMatchObject({ source: 'fallback', resolvedLocale: 'en', path: '/de/leitfaden/advanced-en-only' })
    expect(resolveContentRoute(fallbackAlternate!.path, fallbackAlternate!.locale, policy, index)?.canonicalKey)
      .toBe('docs/advanced-en-only')
  })

  // --- Deferred assertions (VNEXT 20.1) -------------------------------------
  //
  // PHASE-2B: the paired setup-failure test from VNEXT 20.5 ("Nuxt I18n
  //   installed + duplicate Ginko locale/default fields must fail setup") is
  //   explicitly Phase 2B behavior (immutable locale policy, §12.1/§22) and
  //   is not implemented here.
})
