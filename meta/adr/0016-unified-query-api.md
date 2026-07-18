---
type: ADR
id: "0016"
title: "Unified query API"
status: active
date: 2026-05-01
---

## Context

Content reads once exposed several overlapping builders, helpers, and
composables. Callers had to choose among APIs with different locale and route
semantics, and document selection was mixed with set filtering.

The public surface needs one vocabulary that works in browser, server, and
script contexts while keeping provider transport details private.

## Decision

Use collection handles with these pure asynchronous operations:

- `one()` for one selected document;
- `many()` for a result set;
- `paginate()` for explicit offset or cursor pagination;
- `resolveOne()` for a selected document plus resolution diagnostics;
- `navigation()` for a collection navigation tree;
- `surround()` for previous and next entries;
- `backlinks()` for inbound references.

Client and server exports use the same option and result shapes. Server calls
take the active H3 event first. The only public Vue composables are
`useContentPage()` for route-backed page loading and `useContentSearch()` for
search state; other reactive workflows compose the pure operations with Nuxt's
`useAsyncData()`.

### Selection and filtering

`by` identifies exactly one document and is an exclusive selector:

```ts
type ContentSelector =
  | { route: string, path?: never, ref?: never }
  | { path: string, route?: never, ref?: never }
  | { ref: string, route?: never, path?: never }
```

`where` filters result sets with the documented field comparison operators and
structural `$and`, `$or`, and `$not` nodes. Public callers cannot use the
provider-only `$regex` transport operator.

```ts
const post = await one(blog, { by: { route: '/blog/hello' } })

const posts = await many(blog, {
  where: { category: { $in: ['tech'] }, published: true },
  sort: { date: 'desc' },
  limit: 10
})
```

### Locale requirements

Collection handles carry whether the collection is localized. Options are
type-required for localized handles and must name a locale; non-localized
handles may omit them where the operation otherwise has no required option.
Fallback is always explicit in direct query operations.

```ts
await many(docs, { locale: 'de' })
await many(docs, { locale: 'de', fallback: ['en'] })
await navigation(docs, { locale: 'de' })
```

Navigation deliberately fills missing locale entries through the configured
fallback chain so sidebars remain complete, while ordinary list queries remain
strict unless the caller requests fallback.

### Document envelope

Every returned document carries one canonical route and resolution envelope:

```ts
{
  locale: 'de',
  route: {
    requestedPath: '/de/dokumentation/einstieg',
    resolvedPath: '/de/dokumentation/einstieg',
    alternates: [
      { locale: 'en', path: '/docs/getting-started', source: 'variant' },
      { locale: 'de', path: '/de/dokumentation/einstieg', source: 'variant' }
    ]
  },
  resolution: {
    requested: { locale: 'de' },
    resolved: { locale: 'de' },
    usedFallback: false
  }
}
```

There are no parallel top-level path, locale-path, variant, or resolved aliases.

### Provider boundary

Public options lower once into the versioned, JSON-pure provider query plan.
Providers advertise executable comparison operators and pagination modes.
Logical plan nodes are structural parts of the wire and are not separate
capabilities. Unsupported comparison operators fail before provider dispatch.

## Alternatives considered

- Keep specialized helpers for every read shape. Rejected because they create
  overlapping semantics and duplicate documentation.
- Infer locale from ambient client state in every operation. Rejected because
  server and script callers would behave differently and localized omissions
  would remain type-invisible.
- Put selection fields inside `where`. Rejected because identity resolution and
  set filtering have different fallback and diagnostic behavior.
- Add compatibility aliases for removed query names or result fields. Rejected
  because this was a pre-stable hard cutover and aliases would create a second
  source of truth.

## Consequences

- Public query behavior has one vocabulary across runtimes.
- Localized calls make locale intent explicit and type-checkable.
- Route switching uses `route.alternates`; diagnostics use `resolveOne()`.
- Providers implement one closed plan rather than reconstructing app-level
  options.
- Changes to query grammar, provider capabilities, public types, contract tests,
  and reference documentation must land together.
