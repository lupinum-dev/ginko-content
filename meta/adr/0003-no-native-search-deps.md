---
type: ADR
id: "0003"
title: "No native search dependencies — JSON index + Pagefind"
status: active
date: 2026-04-24
---

## Context

Nuxt Content v3 uses `better-sqlite3` as its runtime content/search
store. In practice, that choice has been a recurring source of friction:

- native module rebuilds fail intermittently across Node versions,
  package managers, Docker base images, and serverless runtimes
- coding agents and CI pipelines struggle with it
- when it works it is fast; when it breaks it blocks shipping for days

For the target audience (see
[ADR-0002](./0002-target-small-to-medium-content-sites.md)), the
performance win of a native engine is not worth the operational cost.

## Decision

**Ginko has zero native runtime dependencies.**

Search uses two transports, both natively portable:

- **JSON search index** — a static payload generated at build, consumed by
  `useContentSearchData` / `useContentSearchResults` on the client. Powered
  by [MiniSearch](https://github.com/lucaong/minisearch) under the hood.
- **Pagefind** — a static index with per-locale shards, generated at build,
  delivered as regular static assets.

Both work in SSG. Both work with SSR. Neither requires compiling anything
at install time.

The filesystem search model is intended for small-to-medium sites. It is
best for a few hundred documents and should remain reasonable up to around
2,000 Markdown documents depending on content size, translation count, and
index shape. Larger sites should use Pagefind carefully, an external
search service, or a provider-owned search backend.

## Alternatives considered

- **`better-sqlite3`.** Rejected for the reasons above.
- **`node:sqlite` built-in.** Considered. Still a database the user must
  reason about; overkill for the target scale; Node version floor would
  be higher than we want.
- **`sql.js` (pure-JS SQLite).** Rejected. Large WASM payload,
  query-planner overhead for zero real benefit at this scale.
- **`lunr.js` only.** Considered. MiniSearch is lighter, more actively
  maintained, and produces smaller indexes.
- **LocalStorage / IndexedDB cached indexes.** Considered as a future
  optimization. Not a blocker for 1.0.

## Consequences

- Install is painless. No post-install scripts, no native toolchain.
- Docker images are smaller. Serverless cold starts do not need to load
  a compiled module.
- The JSON payload grows roughly linearly with content. Past the
  small-to-medium range, shipping the full index to the browser becomes
  unattractive.
- Pagefind covers medium-size sites well but is also not infinite.
- CMS/provider search is provider-owned and can be selected with
  `engine: 'cms'`.
- For sites above the filesystem search range, we document external or
  provider-owned search rather than grow our own native search backend.
