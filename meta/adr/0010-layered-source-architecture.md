---
type: ADR
id: "0010"
title: "Layered source architecture"
status: active
date: 2026-04-24
---

## Context

Nuxt Content v2/v3 accumulated logic in a single large `runtime/`
directory mixed with module-time code, utility helpers, and Nitro- and
Vue-specific glue. That made it hard to:

- reason about framework coupling ("can I use this on the server?")
- test domain logic without a Nuxt app
- refactor without cascading changes across unrelated features
- keep domain concepts (query, content graph, references) from bleeding
  into framework concerns

We want to keep the module maintainable over years, including by
contributors and by coding agents that are sensitive to file layout.

## Decision

Enforce a **layered source architecture** with explicit dependency
direction:

```
src/
  core/          pure domain logic      depends on: types
  features/      user-facing behavior   depends on: core, types
  storage/       state + manifest + io  depends on: integrations, features, core, types
  integrations/  framework bindings     depends on: features, core, types
  parsers/       format entrypoints     depends on: core, types
  runtime/       thin Nuxt/Nitro entry  depends on: storage, integrations, features, core, types
  public/        export-facing API      depends on: runtime + the above
  types/         shared type defs       no dependencies
  utils/         small cross-cutting    no domain logic
```

Allowed directions:

1. `core` → `types`
2. `features` → `core`, `types`
3. `integrations` → `features`, `core`, `types`
4. `storage` → `integrations`, `features`, `core`, `types`
5. `runtime` → all of the above

Disallowed:

- `core` importing from `runtime`
- `features` importing from `runtime`
- `storage` importing from `runtime`
- `core` importing Nitro, Vue, or Nuxt APIs
- new generic `utils/` directories containing domain logic

## Alternatives considered

- **Keep a single `runtime/` layer.** Rejected. That is the current
  pain. Domain logic and framework glue stay tangled.
- **Feature-based folders ("search/", "i18n/", "query/" at root).**
  Considered. Works for small modules, but fails at the feature/domain
  boundary: "query" is both a domain concept and a feature surface.
  Layer-based is clearer here.
- **Strictly enforce via lint rules only.** Reasonable, and we may add
  ESLint rules. But the layout itself is the first defense.

## Consequences

- Domain logic (`core/`, `features/`) is unit-testable without spinning
  up Nuxt.
- Framework version bumps (Nuxt 4, Nitro changes) touch `integrations/`
  and `runtime/`, not `core/`.
- The public export map in `src/public/` is a stable seam even as
  internal layout evolves.
- Runtime server entrypoints and similar files exist as thin compatibility
  facades and should not grow logic.
- New contributors have a reliable question to ask: "what layer does
  this belong in?" The answer is usually obvious once you know the
  rules.
