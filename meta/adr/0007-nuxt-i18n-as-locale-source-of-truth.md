---
type: ADR
id: "0007"
title: "`@nuxtjs/i18n` is the locale source of truth"
status: active
date: 2026-04-24
---

## Context

Localization affects routing, application strings, content variants, fallback,
search, and SEO. Re-declaring locale authority in both Nuxt I18n and Ginko would
permit contradictory locale sets and defaults.

Ginko must also support content-only localization for applications that do not
need locale-aware application routing.

## Decision

When `@nuxtjs/i18n` is installed, it is the sole authority for `locales`,
`defaultLocale`, and route strategy. Ginko reads those values and rejects
duplicate `content.i18n.locales` or `content.i18n.defaultLocale` declarations.

`content.i18n` may still declare content-specific policy:

```ts
export default defineNuxtConfig({
  i18n: {
    locales: ['en', 'de'],
    defaultLocale: 'en',
    strategy: 'prefix_except_default'
  },
  content: {
    i18n: {
      fallback: { de: ['en'] },
      translatedSlugs: true
    }
  }
})
```

The supported Nuxt I18n route strategy for the 0.3 release line is
`prefix_except_default`; unsupported strategies fail setup explicitly.

Without `@nuxtjs/i18n`, `content.i18n` owns locales, the default locale,
fallback, and translated-slug policy. Content reads, fallback, and collection
localization remain supported, but Ginko does not become an application route
localization framework.

Route-less server and build contexts have no hidden ambient locale. Callers pass
locale explicitly or use the configured default through the documented API.

## Alternatives considered

- Merge two independently declared locale sets. Rejected because the result has
  no clear authority and can hide configuration mistakes.
- Require Nuxt I18n for every localized collection. Rejected because
  content-only sites do not need application route translation.
- Let Ginko own a second route strategy. Rejected because it would conflict
  with Nuxt I18n and duplicate routing behavior.

## Consequences

- Integrated applications configure locale identity once in Nuxt I18n.
- Ginko owns only content fallback and translated-slug behavior in that mode.
- Duplicate authority and unsupported route strategies fail with actionable
  setup errors.
- Content-only localization remains a deliberate supported mode.
