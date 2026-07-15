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

## Addendum (2026-07-08, Phase 4) — the real top-level tree

The original Decision named nine directories. The tree the refactor
actually landed (Phases 1–4) has **fifteen** top-level homes. This
addendum records the current map without rewriting the original
decision. The enforced invariants are unchanged; the coverage of
directories is wider. The enforcement is
`test/unit/architecture-boundaries.test.ts`, and
`packages/content/ARCHITECTURE.md` carries the contributor-facing
version of this table.

All fifteen `packages/content/src/` homes, with allowed dependency
edges (top-level directory → top-level directory):

```
types/         shared type defs        → (nothing)
utils/         cross-cutting helpers   → types                       (no domain logic)
core/          pure domain logic       → types
parsers/       format entrypoints      → core, types
features/      domain capabilities     → core, types, features       (feature→feature legal)
storage/       filesystem-provider io  → core, features, integrations, types
integrations/  framework bindings      → core, features, types (+ storage ingest, + public type-only)
module/        Nuxt build-time setup   → types, core, features, parsers, utils (+ thin runtime helper)
runtime/       thin Nuxt/Nitro/Vue     → all internal layers + public
public/        export facades          → runtime, features, core, types
config.ts      /config subpath entry   → core, types
cms-contract/  CMS contract builder    → core, types
portability/   pure portable model     → cms-contract
portability-node/ safe Node directory  → portability, cms-contract
cli/           doctor CLI              → core, parsers, types
testing/       provider conformance    → core, features, public, runtime, types
```

Notes on the deltas from the original decision:

- **`features/` gained internal edges.** Phase 4 (T4.1) moved the query
  *composition* layer from `runtime/query/` into `features/query/`, and
  (T4.2) extracted the LLM markdown output feature into `features/agent/`.
  `features/query` composes `core/query` with `features/localization`;
  `features/navigation` composes `features/localization` too. The
  boundary test permits feature→feature and forbids feature→runtime, so
  these edges are legal by design.
- **`integrations/` is coupled to `storage/` and (type-only) `public/`.**
  The ingest hook (`integrations/nitro/ingest.ts`) calls
  `storage/validation`, and `integrations/nitro/context.ts` imports the
  `ContentCacheHint` *type* from `public/provider`. Neither is
  machine-forbidden; both reflect that the filesystem provider's
  storage and its Nitro binding are a closely-coupled pair.
- **`module/` touches `runtime/` once** (`module/options.ts` imports the
  sitemap-source helper from `runtime/utils/`). Build-time setup code is
  not covered by the runtime-import bans (which target `core`,
  `features`, and `storage`).
- **The enforced bans are exactly:** `core ↛ runtime`, `core ↛ features`,
  `features ↛ runtime`, `storage ↛ runtime`, and `core ↛` Nitro/Vue/Nuxt.
  The other edges above are conventions, not tests.

## Addendum (2026-07-08) — `agent` is the code name for LLM markdown output

The `features/agent` and `runtime/server/agent-markdown.ts` homes serve
the **LLM markdown output** feature (`/raw/*.md`, `/llms.txt`,
`/llms-full.txt`, component→markdown serializers). "LLM markdown output"
is the prose term; the code identifiers stay `agent` (the shipped module
option is `agent: {...}`). This is unrelated to ginko-cms "agent
operations" (a different subsystem in a different repo).
