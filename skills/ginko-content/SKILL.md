---
name: ginko-content
description: Use when Codex needs to work with Ginko Content in a Nuxt app, including installing or configuring @lupinum/ginko-content, writing content.config.ts collections, using the unified query API, ContentRenderer, navigation, search, i18n, sitemap, migrating from Nuxt Content v2/v3, or running ginko-content doctor validation.
---

# Ginko Content

Use this skill for app-facing work with `@lupinum/ginko-content`. It is for users and their agents working in Nuxt apps, not for changing Ginko internals.

## Workflow

1. Inspect the app before editing:
   - `package.json`
   - `nuxt.config.ts`
   - `content.config.ts`
   - `app/pages`, `pages`, `content`, `components`, and search/navigation setup
2. Identify the task type and read only the matching reference:
   - First install or small setup: [references/quickstart.md](references/quickstart.md)
   - Pages, lists, rendering, `_path`, and route-safe `path`: [references/querying-rendering.md](references/querying-rendering.md)
   - Nuxt Content migration: [references/migration.md](references/migration.md)
   - Localized content: [references/i18n.md](references/i18n.md)
   - Search and sitemap: [references/search-sitemap.md](references/search-sitemap.md)
3. Prefer the app's existing conventions for UI, route names, collections, and locales.
4. Validate with the smallest relevant commands first, then broader app gates when public behavior changed.

## Hard Rules

- Import config helpers from `@lupinum/ginko-content/config`.
- Use `useContentOne(handle, { by: { route }, locale })` for route-backed content pages.
- Use `useContentMany(handle, options)` for list pages and UI links.
- Use `one(handle, options)` and `many(handle, options)` for custom queries and exact raw lookups.
- Use `item.path` from `useContentMany()` for links.
- Use `path` only when the payload is already route-shaped, such as page, navigation, search, or surround data.
- Pass the full document to `<ContentRenderer>`, not `document.body`.
- Use `useContentTree()` for layout navigation.
- Use `useContentSearchData().searchNavigation` for search navigation.
- For i18n collections, set `i18n: true` and store files under `content/<locale>/...`.
- Do not manually prepend locale prefixes to `_path` or `path`.
- For Nuxt Sitemap i18n output, validate and submit `/sitemap_index.xml`.
- Do not add route rules or disable `sitemap.autoI18n` only to force a physical `/sitemap.xml` file.
- Run `ginko-content doctor`; use `ginko-content doctor --i18n` for localized apps.

## Validation

Use the package validator when available:

```bash
npx ginko-content doctor
```

For localized apps:

```bash
npx ginko-content doctor --i18n
```

Then run the app's normal gates. Common Nuxt app gates are:

```bash
pnpm lint
pnpm typecheck
pnpm build
```

If a stale dependency appears only in the lockfile, check provenance before changing it:

```bash
pnpm why @nuxt/content better-sqlite3 @standard-schema/spec
```

Lockfile-only transitive packages are not automatically migration failures.
