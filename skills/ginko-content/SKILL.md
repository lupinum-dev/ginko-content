---
name: ginko-content
description: Use when Codex needs to work with Ginko Content in a Nuxt app, including installing or configuring @lupinum/ginko-content, writing content.config.ts collections and schemas, querying and rendering content, routing, navigation, drafts, partials, preview, search, i18n, sitemap, provider/cache contracts, migrating from Nuxt Content v2/v3, or running ginko-content doctor validation.
---

# Ginko Content

Use this skill for app-facing work with `@lupinum/ginko-content`. It is for users and their agents building Nuxt apps, migrations, and provider integrations. It is not for changing Ginko internals unless the user explicitly asks to work inside this repository.

## Workflow

1. Inspect the app before editing:
   - `package.json`
   - `nuxt.config.ts`
   - `content.config.ts`
   - `app/pages`, `pages`, `content`, `components`, and search/navigation setup
2. Identify the task type and read only the matching reference:
   - First install or small setup: [references/quickstart.md](references/quickstart.md)
   - Collections, schemas, references, and collection handles: [references/collections.md](references/collections.md)
   - Pages, lists, rendering, `_path`, and route-safe `path`: [references/querying-rendering.md](references/querying-rendering.md)
   - Drafts, partials, and preview mode: [references/preview-drafts.md](references/preview-drafts.md)
   - Localized content: [references/i18n.md](references/i18n.md)
   - Search and sitemap: [references/search-sitemap.md](references/search-sitemap.md)
   - Provider, CMS, and cache integrations: [references/providers-cache.md](references/providers-cache.md)
   - Nuxt Content migration: [references/migration.md](references/migration.md)
3. Prefer the app's existing conventions for UI, route names, collections, and locales.
4. Validate with the smallest relevant commands first, then broader app gates when public behavior changed.

## Hard Rules

- Import config helpers from `@lupinum/ginko-content/config`.
- Export collection handles from `content.config.ts` when app code imports them.
- Define collections as `defineCollection('name', { ... })`.
- Use disjoint filesystem globs; overlapping collections are invalid.
- Use `useContentPage(handle, options)` for route-backed content pages.
- Use `useContentMany(handle, options)` for list pages and UI links.
- Use `one(handle, options)` and `many(handle, options)` for custom queries and exact raw lookups.
- Use `item.path` from `useContentMany()` for links.
- Use `path` only when the payload is route-shaped, such as page, list, navigation, search, or surround data.
- Use `_path` for canonical content-path filters and low-level lookups.
- Pass the full document to `<ContentRenderer>`, not `document.body`.
- Use `useContentTree()` for layout navigation.
- Hide pages from navigation with `navigation: false`, not `hidden: true`.
- Use `useContentSearchData().searchNavigation` for search navigation.
- For i18n collections, set `i18n: true` and store files under `content/<locale>/...`.
- Do not manually prepend locale prefixes to `_path` or `path`.
- Treat `_draft` and underscore paths as partials, not drafts.
- Treat public production queries as excluding drafts and partials unless preview mode is active.
- Add `collections: ['docs']` to search config unless the app intentionally indexes every route-backed collection.
- Keep data-only collections out of sitemap output; sitemap is for route-backed page collections.
- For Nuxt Sitemap i18n output, validate and submit `/sitemap_index.xml`.
- Do not add route rules or disable `sitemap.autoI18n` only to force a physical `/sitemap.xml` file.
- Run `ginko-content doctor`; use `ginko-content doctor --i18n` for localized apps.

## Validation

Use the package validator through the app's package manager. For pnpm:

```bash
pnpm exec ginko-content doctor
```

For localized apps:

```bash
pnpm exec ginko-content doctor --i18n
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
