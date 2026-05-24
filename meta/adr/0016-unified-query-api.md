---
type: ADR
id: "0016"
title: "Unified query API"
status: active
date: 2026-05-01
---

## Context

Pre-redesign, the package shipped 13+ overlapping public query symbols:

- Fluent builders: `queryCollection`, `queryCollectionPage`,
  `queryCollectionNavigation`, `queryCollectionRouteMeta`,
  `queryCollectionSearchSections`, `serverQueryCollection`.
- Composables: `useContentPage`, `useContentList`, `useContentNavigation`,
  `useContentRoute`, `useContentSwitchLocalePath`.
- Reference resolution: `resolveContentReference`.
- Sundry: `querySiteData`.

Three problems:

1. **No single way in.** Three competing styles (chained builder, route-aware
   composable, list helper) plus a dozen specializations. Agents and humans
   struggle to pick the right one.
2. **Locale resolution was implicit.** `.locale()` was optional; when omitted
   the system reached for `useI18n().locale` or the route prefix. Type-safety
   was impossible — a missing locale silently returned wrong-locale results.
3. **`path`/`ref` resolution was buried** inside `useContentPage` and
   `resolveContentReference`. The same identifier system used by markdown
   `[link](ref:guide.intro)` had no first-class equivalent in TS code.

The package is pre-release greenfield, so a hard break was acceptable.

## Decision

Replace the entire surface with **one explicit content-query vocabulary**:

- `by` identifies exactly one document by rendered `route`, content `path`, or
  authored `ref`.
- `where` filters result sets with a MongoDB-style field filter.
- `locale` is type-required on i18n collection handles.
- `fallback` is explicit and narrowly defined.
- `resolveOne()` is the first-class diagnostic path.

### Public surface

```ts
// content.config.ts — handle carries the name and i18n flag at the type level
export const docs = defineCollection('docs', {
  type: 'page',
  source: 'docs/**/*.md',
  i18n: { locales: ['en', 'fr', 'de'], defaultLocale: 'en' },
  translatedSlugs: true,
})
export const blog = defineCollection('blog', { type: 'page', source: 'blog/**/*.md' })

// Layer 1 — pure async (server, scripts, edge)
one(docs, { locale: 'fr', by: { route: '/fr/documentation/pour-commencer' } })
many(blog, {
  where: { category: { $in: ['tech'] }, published: true },
  sort: { date: 'desc' },
  limit: 10,
})
resolveOne(docs, { locale: 'fr', by: { ref: 'guide.getting-started' } })
variants(docs, { locale: 'fr', by: { ref: 'guide.getting-started' } })
tree(docs, { locale: 'fr', fallback: 'default' })
neighbors(docs, { locale: 'fr', by: { ref: 'guide.getting-started' } })

// Layer 2 — Vue composables, identical option shape, MaybeRefOrGetter for every option
useContentOne(docs, { locale, by: { route: () => route.path }, fallback: 'en' })
useContentMany(blog, { where: { ... }, sort: { date: 'desc' }, limit: 10 })
useContentResolveOne(docs, { locale, by: { ref: () => page.value?.ref || '' } })
useContentVariants(docs, { locale, by: { ref: () => page.value?.ref || '' } })
useContentTree(docs, { locale })
useContentNeighbors(docs, { locale, by: { ref: () => page.value?.ref || '' } })
```

### `by` vs `where`

`by` is an XOR selector:

```ts
type ContentSelector =
  | { route: string, path?: never, ref?: never }
  | { path: string, route?: never, ref?: never }
  | { ref: string, route?: never, path?: never }
```

`path` and `ref` route through the content graph:

- `by: { route: '/x' }` — resolves the rendered route a visitor is on. For
  localized collections this is the page-loading selector because it preserves
  translated slug and fallback semantics.
- `by: { path: '/x' }` — resolves the canonical content path. When locale or
  fallback is set, becomes a
  `resolveVariant` lookup against `byRoute` (locale-aware route
  resolution). When neither is set, becomes a plain `_path` equality
  so non-i18n collections work the same way.
- `by: { ref: 'guide.intro' }` — routes through `byRef` /
  `referenceTargets`, the same lookup tables markdown's
  `[link](ref:guide.intro)` already uses.

`where` is only for filtering result sets.

MongoDB-style operator object replaces the old string-named operators
(`'='`, `'IN'`, `'CONTAINS_ANY'`, `'REGEX'`, `'ICONTAINS'`, `'EXISTS'`,
`'TYPE'`).

| Old | New |
|---|---|
| `.where('cat', '=', 'tech')` | `where: { cat: 'tech' }` or `{ cat: { $eq: 'tech' } }` |
| `.where('cat', 'IN', [...])` | `where: { cat: { $in: [...] } }` |
| `.where('title', 'ICONTAINS', 'x')` | `where: { title: { $regex: 'x', $options: 'i' } }` |
| `.where('field', 'EXISTS')` | `where: { field: { $exists: true } }` |
| `.andWhere(...)` / `.orWhere(...)` | `where: { $and: [...] }` / `{ $or: [...] }` |

`where.path` is a documented route-path filter for result sets. It
compiles to internal `_path`, including prefix filters:

```ts
many(posts, { where: { path: { $prefix: '/blog/2026' } } })
```

### Type-required locale

A collection handle from `defineCollection(name, config)` carries a
phantom `__i18n: true | false` discriminator. The `OneOptions<H>`,
`ManyOptions<H>`, `TreeOptions<H>`, `VariantsOptions<H>`, and `NeighborsOptions<H>` types
make `locale` required when `H['__i18n']` is `true`:

```ts
one(docs, { by: { ref: 'guide.intro' } })                    // ❌ TS error
one(docs, { locale: 'fr', by: { ref: 'guide.intro' } })      // ✅
one(docs, { locale: 'fr', by: { route: '/fr/guide/intro' } })// ✅
one(blog, { by: { path: '/hello' } })                        // ✅ (single locale)
```

The type-level test suite at
`test/fixtures/typecheck/types/ginko-api.ts` covers both positive and
negative cases.

### Localized doc shape

Every document returned by `one` / `many` / `resolveOne().doc` carries route metadata
plus a `localePaths` map populated for **every** configured locale:

```ts
{
  ...frontmatter,
  locale: 'fr',
  path: '/fr/documentation/pour-commencer',
  ref: 'guide.getting-started',
  localePaths: {
    en: { path: '/en/guide/getting-started', translated: true },
    fr: { path: '/fr/documentation/pour-commencer', translated: true },
    de: { path: '/en/guide/getting-started', translated: false, fallback: 'en' },
  }
}
```

Locale switchers can render the full picture in five lines without a
second query — and "translated from English" affordances are
explicit, not silent.

### Strict-by-default locale semantics

`many(docs, { locale: 'de' })` defaults to **strict** locale matching
(`exact: true` at the resolver level). Fallback is opt-in:

```ts
many(docs, { locale: 'de' })                       // German variants only
many(docs, { locale: 'de', fallback: true })       // configured chain
many(docs, { locale: 'de', fallback: 'en' })       // explicit fallback
many(docs, { locale: 'de', fallback: ['fr','en'] })// explicit chain
```

The old API exhibited the opposite: `.locale('de')` quietly fell back to
the configured chain. Strict-by-default surfaces missing translations as
empty results instead of cross-locale leaks.

## Reused infrastructure (unchanged)

- `resolveGraphVariant` / `resolveGraphRouteVariant` —
  `packages/content/src/core/content/graph.ts:222,271`.
- `localizePageResult`, `createLocalePaths` —
  `packages/content/src/features/localization/results.ts:35,49`.
- ADR-0008 numeric-prefix translation system —
  `packages/content/src/features/localization/translated-slugs.ts`.
- Nitro routes under `packages/content/src/runtime/server/api/`.
- `fetchContentApi` transport —
  `packages/content/src/runtime/app/composables/utils.ts`. (Reworked to
  reach Nuxt-only auto-imports through `globalThis` lookups so the
  module can be safely traversed from a pure-Nitro bundle.)

## Consequences

- **One `query()` mental model** for users and agents alike. Same
  options on the server, in scripts, in Nitro routes, and in Vue
  components — only the wrapper composable differs.
- **MongoDB filter literacy is portable.** Anyone who has used
  Mongo or Mongoose recognises the operator vocabulary.
- **`localePaths` is now object-shaped** (`{ path, translated, fallback? }`
  instead of plain strings). Existing code that read these as strings
  needs a one-line update — covered in the migration guide.
- **`.locale()` no longer falls back silently.** Fallback is opt-in.
  Callers that relied on the old loose semantics need to add
  `fallback: true` (or an explicit chain).
- **`useContentRoute` / `useContentSwitchLocalePath` are gone.** Pages
  expose their own `localePaths` and the locale switcher composes:
  `page.localePaths[locale]?.path ?? switchLocalePath(locale)`.

This ADR supersedes the public-API parts of ADR-0006/0007/0008. The
identity model and translation infrastructure those ADRs introduced are
preserved unchanged — only the user-facing call site changes.

## Hard-cut query shape (2026-05)

Review of the first unified-query draft showed that putting `path` /
`ref` inside `filter` blurred two different concepts. The final public
shape makes the distinction explicit:

- **`by` identifies one document.** It is an XOR selector:
  `{ route: string } | { path: string } | { ref: string }`.
- **`where` filters result sets.** It is the MongoDB-style field filter
  and rejects typo'd schema fields at compile time.
- **`resolveOne()` is the diagnostic primitive.** It returns
  `{ doc, explain }`; `one()` is the ergonomic `doc`-only view.
- **`many()` replaces `find()`.** The API reads as content operations,
  not database implementation details.
- **`tree()` has typed field projection.** `fields: ['title'] as const`
  preserves those fields in the returned navigation item type without
  keeping an open index signature.
- **`variants()` and `neighbors()` require `by`.** i18n handles also
  require `locale`, including `variants()`, so the "i18n requires locale"
  rule has no hole.
- **Fallback policy is explicit.** Supported values are `false`, `true`,
  `'default'`, a locale string, or a locale array. No hand-wavy
  `'nearest'` mode exists.
- **No hidden debug field.** The non-enumerable `_resolution` idea was
  dropped. Call `resolveOne()` when diagnostics matter.

Migration from the draft shape:

```ts
// Draft
findOne(docs, { locale: 'de', filter: { path: route.path }, fallback: true })
find(posts, { filter: { draft: { $ne: true } }, sort: { date: -1 } })
neighbors(docs, { locale: 'de', filter: { ref: 'guide.intro' } })

// Final
one(docs, { locale: 'de', by: { path: route.path }, fallback: true })
many(posts, { where: { draft: { $ne: true } }, sort: { date: 'desc' } })
neighbors(docs, { locale: 'de', by: { ref: 'guide.intro' } })
```

For diagnostics:

```ts
const { doc, explain } = await resolveOne(docs, {
  locale: 'de',
  by: { path: route.path },
  fallback: true
})
```

Acceptable because the package is pre-release; playground, docs app,
type tests, and integration coverage were updated in the same change.
