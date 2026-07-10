---
type: ADR
id: "0007"
title: "`@nuxtjs/i18n` is the locale source of truth"
status: active
date: 2026-04-24
---

## Context

Localization cuts across the entire stack: routing, layouts, SEO,
strings, and content. Nuxt already has a mature i18n module
(`@nuxtjs/i18n`) that owns route strategy, locale detection, language
switching, and translated page titles.

A content module has two options:

1. duplicate all that locale logic internally, and hope to stay in sync
2. delegate to the existing i18n module and layer content-specific
   behavior on top

v3 effectively picks (1) by forcing per-locale collections and leaving
the reconciliation to the user. The result is the common complaint that
"translations in Nuxt Content are painful."

## Decision

**When `@nuxtjs/i18n` is installed, it is the authoritative source of
truth for locales.** Ginko reads the configured locales, default
locale, and route strategy from `@nuxtjs/i18n` rather than re-declaring
them.

`content.i18n` in `nuxt.config.ts` only declares **content-specific**
extensions:

```ts
export default defineNuxtConfig({
  content: {
    i18n: {
      defaultLocale: 'en',
      locales: ['en', 'de'],
      fallback: { de: ['en'] },
      translatedSlugs: false
    }
  }
})
```

Rules:

- `translatedSlugs` defaults to off. See
  [ADR-0008](./0008-translated-slugs-via-numeric-prefix.md).
- Collection-local i18n opt-in exists — a collection can opt in/out of
  the runtime locale system.
- Route-aware helpers infer the active locale from the route by default.
- Route-less contexts (server utilities, build scripts) have **no
  ambient locale**. The caller passes locale explicitly or the system
  uses `defaultLocale` without hidden route behavior.
- Single-document reads are locale-aware with fallback by default.
- List queries do **not** mix locales by default. Opt in via
  `.locale('de', { fallback: true })`.

## Alternatives considered

- **Own locale config inside the content module.** Rejected. Duplicates
  `@nuxtjs/i18n`'s role, forces users to declare locales twice and keep
  them in sync.
- **Make `@nuxtjs/i18n` a peer dependency (required).** Rejected.
  Single-locale sites should not need it.
- **Custom route strategy for content.** Rejected. Collides with
  `@nuxtjs/i18n`'s strategies; surprises users who expect consistent URLs.
- **Fallback-mixing list queries by default.** Rejected. Quietly merging
  locales into list results is a frequent source of "why is German text
  showing on the English page" bugs.

## Consequences

- Single-locale sites configure nothing extra.
- Multi-locale sites configure `@nuxtjs/i18n` once and get content
  behavior that matches their route strategy automatically.
- We depend on `@nuxtjs/i18n` semantics and follow them upstream.
- Content-specific fallback and translated-slug behavior stay in
  `content.i18n` where they belong.
- **Content-only localization is a fully supported mode, not a
  degraded fallback.** A site can declare multiple locales, a default
  locale, and per-collection `i18n` config entirely through
  `content.i18n` in `nuxt.config.ts` without installing `@nuxtjs/i18n`
  at all. Single-document reads, list queries, and locale fallback all
  work the same way; the only thing Ginko does not do on its own is own
  route strategy/i18n routing (that remains `@nuxtjs/i18n`'s job when
  present).

## Status note (Phase 0, 2026-07)

This ADR states two things at different levels of maturity:

- **Already true today (0.2.x):** content-only localization (the bullet
  above) builds and resolves without `@nuxtjs/i18n` installed, and when
  `@nuxtjs/i18n` *is* installed, Ginko reads its `defaultLocale` and
  `locales` into `content.i18n` resolution.
- **Not yet enforced (target invariant, tracked separately, not part of
  Phase 0):** the stronger rule that installing `@nuxtjs/i18n` *while
  also* declaring conflicting Ginko-owned locale/default authority in
  `content.i18n` must fail setup with an actionable error. Today the two
  configurations are merged (Ginko's `content.i18n` values, `@nuxtjs/i18n`'s
  `defaultLocale`/`locales`, deduplicated) rather than validated for
  conflicts. Implementing the fail-setup behavior is a later-phase change,
  not a Phase 0 truth correction — this note exists so the decision above
  is not mistaken for current runtime behavior.
