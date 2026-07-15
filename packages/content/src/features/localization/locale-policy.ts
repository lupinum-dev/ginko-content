/**
 * One pure, unit-testable resolver for the immutable per-collection locale
 * policy.
 *
 * This module owns:
 * - locale/default-locale authority (Nuxt I18n vs. Ginko content-only);
 * - fallback chain validation (ordering, unknown targets, self-loops, cycles);
 * - the single immutable `ResolvedLocalePolicy` consumed by every downstream
 *   feature (route, navigation, search, sitemap, prerender, agent code).
 *
 * It does not read Nuxt config or module options directly — callers extract
 * the plain inputs so this stays a pure function with no Nuxt dependency,
 * which is what makes it unit-testable without booting a Nuxt instance.
 */

/**
 * Nuxt I18n routing strategies proven end-to-end for 0.3.
 * Any other strategy must fail setup rather than project unverified paths.
 */
import { normalizeRouteMounts } from '../../core/content/path'

export const SUPPORTED_NUXT_I18N_STRATEGY = 'prefix_except_default' as const

export class LocalePolicyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalePolicyError'
  }
}

export interface NuxtI18nAuthorityInput {
  /** Whether `@nuxtjs/i18n` is registered in `nuxt.options.modules`. */
  installed: boolean
  locales?: string[]
  defaultLocale?: string
  /** Nuxt I18n `strategy` option; defaults to `prefix_except_default`. */
  strategy?: string
}

export interface ContentLocaleAuthorityInput {
  locales?: string[]
  defaultLocale?: string
  fallback?: Record<string, string[]>
  translatedSlugs?: boolean
}

export interface LocalePolicyCollectionInput {
  name: string
  /** Whether the collection opts into localization at all. */
  localized: boolean
  /**
   * Base route mount for the collection. A string applies to every locale
   * (subject to translated-slug/mount policy); a per-locale record carries
   * already-translated mounts (e.g. `{ en: '/guide', de: '/anleitung' }`).
   */
  route?: string | Record<string, string>
}

export interface LocalePolicyInput {
  nuxtI18n: NuxtI18nAuthorityInput
  content: ContentLocaleAuthorityInput
  collections: LocalePolicyCollectionInput[]
}

/**
 * Internal locale authority. Deliberately not exposed as a
 * public application type — only the facts application code needs should be
 * exposed by higher-level consumers.
 */
export interface ResolvedCollectionLocalePolicy {
  localized: boolean
  locales: readonly string[]
  defaultLocale?: string
  fallback: Readonly<Record<string, readonly string[]>>
  translatedSlugs: boolean
  /**
   * Per-locale route mount for this collection. Localized collections carry
   * one entry per resolved locale so the
   * canonical route projector never has to fall back to a single default
   * mount for a locale-aware collection. Non-localized collections carry a
   * single `default` entry.
   */
  routeMounts: Readonly<Record<string, string>>
}

export interface ResolvedLocalePolicy {
  /** Which side is the authority for locales/defaultLocale. */
  source: 'nuxt-i18n' | 'content'
  locales: readonly string[]
  defaultLocale?: string
  fallback: Readonly<Record<string, readonly string[]>>
  translatedSlugs: boolean
  strategy: typeof SUPPORTED_NUXT_I18N_STRATEGY | 'content-only'
  collections: Readonly<Record<string, ResolvedCollectionLocalePolicy>>
}

function normalizeLocales(locales: string[] | undefined): string[] {
  return Array.from(new Set((locales ?? []).filter((locale): locale is string => typeof locale === 'string' && locale.length > 0)))
}

/**
 * Validate and normalize an ordered fallback map. Fails (rather than
 * silently dropping) on:
 * - a fallback target that is not a known locale;
 * - a locale falling back to itself (self-loop);
 * - any cycle across the fallback graph.
 *
 * Ordering is preserved exactly as declared — callers rely on first-match-wins
 * semantics.
 */
export function validateLocaleFallback(
  fallback: Record<string, string[]> | undefined,
  locales: readonly string[]
): Readonly<Record<string, readonly string[]>> {
  const knownLocales = new Set(locales)
  const entries = Object.entries(fallback ?? {})
  const result: Record<string, readonly string[]> = {}

  for (const [locale, chain] of entries) {
    if (!knownLocales.has(locale)) {
      throw new LocalePolicyError(
        `@lupinum/ginko-content: content.i18n.fallback declares a fallback chain for unknown locale "${locale}". `
        + `Known locales: ${locales.length ? locales.join(', ') : '(none)'}.`
      )
    }

    for (const target of chain) {
      if (target === locale) {
        throw new LocalePolicyError(
          `@lupinum/ginko-content: content.i18n.fallback for locale "${locale}" falls back to itself. `
          + 'A locale may not appear in its own fallback chain.'
        )
      }
      if (!knownLocales.has(target)) {
        throw new LocalePolicyError(
          `@lupinum/ginko-content: content.i18n.fallback for locale "${locale}" references unknown fallback target "${target}". `
          + `Known locales: ${locales.length ? locales.join(', ') : '(none)'}.`
        )
      }
    }

    result[locale] = [...chain]
  }

  // Cycle detection across the whole fallback graph (DFS with recursion stack).
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const walk = (locale: string, path: string[]): void => {
    if (visited.has(locale)) return
    if (visiting.has(locale)) {
      throw new LocalePolicyError(
        `@lupinum/ginko-content: content.i18n.fallback contains a cycle: ${[...path, locale].join(' -> ')}.`
      )
    }
    visiting.add(locale)
    for (const target of result[locale] ?? []) {
      walk(target, [...path, locale])
    }
    visiting.delete(locale)
    visited.add(locale)
  }
  for (const locale of Object.keys(result)) {
    walk(locale, [])
  }

  return result
}

/**
 * Resolve locale/default-locale authority. When Nuxt I18n is installed it is
 * the sole authority for `locales`/`defaultLocale` — Ginko does not union,
 * ignore, or silently prefer one source.
 */
function resolveAuthority(
  nuxtI18n: NuxtI18nAuthorityInput,
  content: ContentLocaleAuthorityInput
): { source: 'nuxt-i18n' | 'content', locales: string[], defaultLocale: string | undefined, strategy: ResolvedLocalePolicy['strategy'] } {
  if (nuxtI18n.installed) {
    if ((content.locales && content.locales.length > 0) || content.defaultLocale) {
      throw new LocalePolicyError(
        '@lupinum/ginko-content: "@nuxtjs/i18n" is installed, but content.i18n.locales / content.i18n.defaultLocale are also set. '
        + 'Nuxt I18n is the sole locale/default-locale authority when installed — remove content.i18n.locales and '
        + 'content.i18n.defaultLocale from your Nuxt config and configure locales through the "i18n" module instead. '
        + 'content.i18n may still declare "fallback" and "translatedSlugs".'
      )
    }

    const strategy = nuxtI18n.strategy ?? SUPPORTED_NUXT_I18N_STRATEGY
    if (strategy !== SUPPORTED_NUXT_I18N_STRATEGY) {
      throw new LocalePolicyError(
        `@lupinum/ginko-content: Nuxt I18n routing strategy "${strategy}" is not supported. `
        + `Only "${SUPPORTED_NUXT_I18N_STRATEGY}" is proven for 0.3.`
      )
    }

    return {
      source: 'nuxt-i18n',
      locales: normalizeLocales(nuxtI18n.locales),
      defaultLocale: nuxtI18n.defaultLocale,
      strategy
    }
  }

  return {
    source: 'content',
    locales: normalizeLocales(content.locales),
    defaultLocale: content.defaultLocale,
    strategy: 'content-only'
  }
}

/**
 * Resolve the single immutable locale policy for the whole content context,
 * plus one immutable per-collection policy derived from it. Called once at
 * setup; downstream code consumes the result rather than reconstructing it.
 */
export function resolveLocalePolicy(input: LocalePolicyInput): ResolvedLocalePolicy {
  const { source, locales, defaultLocale, strategy } = resolveAuthority(input.nuxtI18n, input.content)

  if (defaultLocale && locales.length && !locales.includes(defaultLocale)) {
    throw new LocalePolicyError(
      `@lupinum/ginko-content: default locale "${defaultLocale}" is not present in the resolved locales list `
      + `(${locales.join(', ') || '(none)'}).`
    )
  }

  const fallback = validateLocaleFallback(input.content.fallback, locales)
  const translatedSlugs = input.content.translatedSlugs ?? false

  const collections: Record<string, ResolvedCollectionLocalePolicy> = {}
  for (const collection of input.collections) {
    const localized = collection.localized && locales.length > 0
    if (collection.localized && locales.length === 0) {
      throw new LocalePolicyError(
        `@lupinum/ginko-content: collection "${collection.name}" opts into localization ("i18n"), `
        + 'but no locales are configured. Localized collections require a usable default locale '
        + '.'
      )
    }
    if (localized && !defaultLocale) {
      throw new LocalePolicyError(
        `@lupinum/ginko-content: collection "${collection.name}" is localized, but no default locale is resolved. `
        + 'Localized collections require a usable default locale.'
      )
    }

    const fallbackMount = `/${collection.name}`
    const routeMounts = localized
      ? (normalizeRouteMounts(collection.route ?? fallbackMount, locales, defaultLocale) ?? { default: fallbackMount })
      : {
          default: typeof collection.route === 'string'
            ? collection.route
            : (collection.route?.default ?? collection.route?.[defaultLocale ?? ''] ?? fallbackMount)
        }

    collections[collection.name] = {
      localized,
      locales: localized ? locales : [],
      defaultLocale: localized ? defaultLocale : undefined,
      fallback: localized ? fallback : {},
      translatedSlugs: localized ? translatedSlugs : false,
      routeMounts
    }
  }

  // Immutability here is a type-level contract (`Readonly<...>`), not a
  // runtime `Object.freeze()`. This object is embedded by reference into
  // Nuxt/Nitro runtime config (module/runtime-config.ts); Nitro's own
  // runtime-config normalization recursively assigns fallback defaults onto
  // every nested object it finds, which throws on frozen objects regardless
  // of environment. Freezing must not reach anything that downstream
  // framework code still needs to write to.
  return {
    source,
    locales,
    defaultLocale,
    fallback,
    translatedSlugs,
    strategy,
    collections
  }
}
