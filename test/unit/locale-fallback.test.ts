import { describe, expect, test } from 'vitest'
import { buildContentGraph, resolveLocaleChain } from '../../packages/content/src/core/content/graph'
import { executeQueryPlan } from '../../packages/content/src/core/query/execute'
import { lowerQueryPlan } from '../../packages/content/src/core/query/lower'
import type { ParsedContent } from '../../packages/content/src/types/content'

/**
 * Behavior suite (T6.2 #3): the locale fallback chain, executed against a real
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

})
