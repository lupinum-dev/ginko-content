---
title: Migration
description: Upgrade notes for moving existing sites onto Ginko.
---

Migration work is mostly API replacement. Ginko keeps filesystem-first authoring, but moves runtime behavior onto explicit collections, explicit queries, and `<ContentRenderer>`.

## In this section

- [From Nuxt Content v2](/docs/migration/from-nuxt-content-v2) — move a v2 project onto the Ginko APIs
- [From Nuxt Content v3](/docs/migration/from-nuxt-content-v3) — move a v3 project onto the Ginko runtime
- [Nuxt app migration recipe](/docs/migration/nuxt-app-recipe) — apply the full app pattern for routes, lists, search, rendering, and sitemap
- [Agent migration packet](/docs/migration/agent-migration-packet) — use terse before/after maps and validation commands
- [I18n migration recipe](/docs/migration/i18n-migration) — apply the full localized app pattern for routes, search, and sitemap
- [Agent i18n migration packet](/docs/migration/agent-i18n-packet) — use exact i18n rules, scans, and artifact checks

Start with the v2 migration guide if your app still uses `ContentDoc` or `queryContent()`. Start with the v3 guide if your app already uses `content.config.ts`, old Nuxt Content `defineCollection({ type, source })` declarations, and `many()`.
