# Refactor Plan: Toward 10/10 Maintainability

## Purpose

This document turns the maintainability review in `findings.md` into an improvement plan. The goal is not to make the codebase abstract, generic, or theoretically perfect. The goal is to make Ginko Content simple to understand, safe to extend, easy to debug, and suitable for a team where junior and mid-level developers can contribute without needing deep tribal knowledge.

The current codebase is already serious: it has architecture docs, contract tests, provider capabilities, typed query APIs, runtime config safeguards, onboarding docs, examples, and a real verification gate. The gap to 10/10 is mostly about reducing central files, tightening contracts, eliminating duplicate derived paths, and making boundary behavior as explicit as the core query system already is.

A 10/10 library here would not mean "more code." It would mean:

- one source of truth for every important concept.
- small modules with obvious ownership.
- public API surfaces that do not leak runtime internals.
- extension contracts that fail loudly and predictably.
- generated/derived data that is marked, rebuildable, and invariant-tested.
- errors that users and provider authors can act on.
- tests that prove contracts, not implementation trivia.
- docs that let a new contributor choose the right file without guessing.

## Current Score Summary

| Dimension | Current | Target |
|---|---:|---:|
| Architecture | 7/10 | 10/10 |
| Public API design | 7/10 | 10/10 |
| Readability | 7/10 | 10/10 |
| Junior-developer understandability | 6/10 | 10/10 |
| Typing/type safety | 7/10 | 10/10 |
| Error handling | 6/10 | 10/10 |
| Testability | 8/10 | 10/10 |
| Documentation | 8/10 | 10/10 |
| Dependency/configuration design | 6/10 | 10/10 |
| Consistency | 7/10 | 10/10 |
| Long-term maintainability | 7/10 | 10/10 |

## Guiding Principles

These are the rules for this refactor:

1. Delete before adding.
2. Prefer hard cutovers for unreleased/internal paths.
3. Do not add compatibility shims for internal runtime/source paths.
4. Do not create new abstractions unless they remove real duplication or enforce a real contract.
5. Every public API remains deliberate and tested.
6. Provider capabilities remain the runtime source of truth.
7. Derived state must be explicitly marked as derived and covered by invariant tests.
8. Keep backend/provider invariants out of frontend orchestration.
9. Avoid adding caches, projections, adapters, or config flags unless the acceptance criteria prove they are required.

## 1. Architecture

### Current: 7/10

The architecture has a real spine. `packages/content/ARCHITECTURE.md` defines layers, and `test/unit/architecture-boundaries.test.ts` verifies some dependency rules. The core query pipeline is well separated across `core/query/filter.ts`, `lower.ts`, `plan.ts`, and `execute.ts`. The provider system has a coherent shape, and CMS contract code has a documented purity boundary.

The score is not higher because the boundaries are less clean at the edges:

- `packages/content/src/module.ts` is a 720-line coordinator that also owns agent markdown route parsing, file writing, search index prerendering, sitemap hook wiring, runtime setup, provider setup, and Nuxt/Nitro hook orchestration.
- `packages/content/src/module/integration-hooks.ts` reparses content from disk for prerender/sitemap discovery. That creates a second ingest-like path next to the normal storage/ingest path.
- `packages/content/src/public/server.ts` exposes many runtime agent helpers directly, making `runtime/server/agent-markdown.ts` and `runtime/server/agent-site.ts` part of the public surface.
- `packages/content/src/runtime/query/unified.ts` is a single large file owning query verbs, response unwrapping, localization decoration, populate validation, reference population, pagination, navigation, variants, and neighbors.
- `packages/content/src/module/runtime-assets.ts` generates type declarations that manually mirror package and dist paths.

The architecture is good enough to work, but not good enough to scale cleanly. Too many important concepts still meet in a few boundary files.

### What 10/10 Means

Architecture is 10/10 when a contributor can answer "where does this behavior belong?" without reading five unrelated files. Each layer owns a narrow concept, import direction is enforced, public facades are thin and stable, and derived/generation paths do not duplicate business logic.

In this codebase, 10/10 would look like:

- `module.ts` only coordinates module setup by calling named registration functions.
- search prerender, agent prerender, sitemap integration, runtime config, type generation, provider registration, and dev runtime setup live in separate files with focused tests.
- prerender/sitemap route discovery reuses a shared content discovery/graph helper or is explicitly documented as a derived path with invariant tests proving it matches the canonical ingest path.
- public exports are facades over intentionally stable functions, not broad re-exports of runtime implementation modules.
- generated type declarations are treated as public API and tested as such.
- runtime query operations are split by responsibility, with a small shared context/response layer.

### Refactors to Reach 10

1. Split `packages/content/src/module.ts`.

Target files:

- `module/defaults.ts`
- `module/provider-registration.ts`
- `module/search-prerender.ts`
- `module/agent-prerender.ts`
- `module/sitemap-registration.ts`
- `module/nitro-registration.ts`

Acceptance criteria:

- `module.ts` is under 250 lines.
- `module.ts` contains no direct `mkdirSync`, `writeFileSync`, Markdown link regex parsing, Pagefind writing, or agent markdown route expansion.
- Existing module contract tests pass.
- New focused tests cover search prerender and agent prerender helpers.

2. Remove duplicated ingest from `module/integration-hooks.ts`.

Target state:

- `parseCollectionFiles` is either deleted or moved into a shared "filesystem discovery for build-time derived routes" helper.
- The helper is explicitly marked as derived from the canonical ingest model.

Acceptance criteria:

- There is one function responsible for turning filesystem content files into parsed documents for build-time graph derivation.
- Tests compare derived prerender route discovery with the canonical graph behavior for localized, translated-slug, draft, partial, navigation, and data files.

3. Split `runtime/query/unified.ts`.

Target files:

- `runtime/query/context.ts`
- `runtime/query/response.ts`
- `runtime/query/decorate.ts`
- `runtime/query/populate.ts`
- `runtime/query/operations/one.ts`
- `runtime/query/operations/many.ts`
- `runtime/query/operations/paginate.ts`
- `runtime/query/operations/tree.ts`
- `runtime/query/operations/variants.ts`
- `runtime/query/operations/backlinks.ts`
- `runtime/query/operations/neighbors.ts`
- `runtime/query/unified.ts` as a small barrel.

Acceptance criteria:

- No operation file exceeds 250 lines.
- Shared helpers have contract tests.
- Public client/server query behavior does not change.

## 2. Public API Design

### Current: 7/10

The main public query API is good. `one`, `many`, `paginate`, `resolveOne`, `tree`, `neighbors`, `variants`, and `backlinks` form a consistent read model. Client and server facades expose similar shapes, which is a strong design.

The score is 7 because the public surface is broader and leakier than it should be:

- `public/server.ts` exports many agent markdown/runtime helpers directly.
- `ContentProvider.query` accepts too many response shapes: envelope, array, single item, number, or `undefined`.
- internal query helpers such as `serverQueryCollection` still exist in runtime files even though package export tests assert they are no longer public.
- generated `#content/server` declarations form another public-ish API surface and mirror many server exports manually.
- public types expose internal transport concepts like `ContentQueryBuilderParams`.

This makes the API convenient but not cleanly bounded.

### What 10/10 Means

Public API design is 10/10 when every exported function has a clear audience, stable name, predictable return shape, and tested behavior. Public types should describe user concepts, not internal transport implementation. External provider authors should know exactly what to implement and what they will receive.

In this codebase, 10/10 would look like:

- `@lupinum/ginko-content/client` and `/server` expose only user-facing, stable functions.
- agent markdown exports are curated behind a small explicit public facade.
- provider authors return one canonical result shape per operation.
- internal transport params are not part of the public provider-facing API unless explicitly intended.
- generated `#content/server` is tested and documented as a public module alias.

### Refactors to Reach 10

1. Curate server exports.

Move agent markdown exports into one of:

- a dedicated `@lupinum/ginko-content/agent` export, if external users genuinely need it.
- or an internal runtime-only surface if these are not public compatibility commitments.

Acceptance criteria:

- `public/server.ts` exports only server query API, provider/cache API, sitemap helper, and intentionally public agent facade.
- Package export tests assert both included and excluded exports.
- Docs list every server export and its use case.

2. Tighten provider return contract.

Replace:

```ts
ContentQueryResponse<T> | T[] | T | number | undefined
```

with explicit envelopes:

```ts
type ProviderQueryResult<T> =
  | { kind: 'many'; result: T[]; total: number; skip: number; limit: number }
  | { kind: 'one'; result: T | null }
  | { kind: 'count'; result: number }
```

If the current public version requires compatibility, use a documented deprecation window. For unreleased internals, hard cut.

Acceptance criteria:

- malformed provider responses fail with `unsupported_query_shape` or `provider_module_invalid`.
- provider contract tests include malformed return shapes.
- docs show exact query return examples.

3. Hide or rename internal query APIs.

Acceptance criteria:

- internal legacy query helpers are either deleted or clearly renamed/internalized.
- no public docs mention old query APIs except migration docs.
- package export tests assert removed APIs remain absent.

## 3. Readability

### Current: 7/10

Core files are readable because they are focused and explain the "why." The immutable builder, query lowerer, and executor are good examples.

Readability drops in large runtime and module files:

- `runtime/query/unified.ts` is too broad.
- `runtime/app/composables/use-content.ts` repeats similar reactive wrapper logic across many operations.
- `module.ts` is too broad.
- `cli/doctor.ts` is over 1000 lines.
- `cms-contract/build.ts` is large and schema-introspection-heavy.

These files are not unreadable, but they require too much context.

### What 10/10 Means

Readability is 10/10 when each file is small enough that a contributor can understand its purpose in minutes, not hours. Complex behavior is broken into named helpers that express domain concepts, not generic abstractions.

In this codebase, 10/10 would look like:

- largest source files are justified by a specific domain, not accidental accumulation.
- public operation files are easy to scan.
- helper names explain behavior.
- comments explain invariants and tradeoffs.
- repeated scaffolding is extracted only where it reduces noise.

### Refactors to Reach 10

1. Set source file size budgets.

Suggested targets:

- normal source files: under 250 lines.
- complex domain files: under 400 lines with clear sections.
- generated-template builders: allowed over 400 only if split would reduce clarity.

Acceptance criteria:

- `module.ts`, `runtime/query/unified.ts`, `runtime/app/composables/use-content.ts`, and `cli/doctor.ts` are split or justified.
- `pnpm fallow:health` or a local script flags new large files for review.

2. Split `use-content.ts`.

Avoid over-generic composable machinery. A small shared helper is enough:

- resolve reactive options.
- compute stable key.
- call `useAsyncData`.

Acceptance criteria:

- each composable operation lives in a file named after the operation.
- shared helper remains under 100 lines.
- type inference remains equivalent.

3. Split `cli/doctor.ts` by rule group.

Target files:

- `cli/doctor/index.ts`
- `cli/doctor/files.ts`
- `cli/doctor/rules/dependencies.ts`
- `cli/doctor/rules/public-api.ts`
- `cli/doctor/rules/rendering.ts`
- `cli/doctor/rules/i18n.ts`
- `cli/doctor/rules/sitemap.ts`
- `cli/doctor/report.ts`

Acceptance criteria:

- each rule has a name, severity, matcher, and focused fixture tests.
- no behavior change in existing doctor contract tests.

## 4. Junior-Developer Understandability

### Current: 6/10

The repository has unusually helpful onboarding docs, and architecture tests give contributors guardrails. A junior can learn the layer map.

The score is 6 because impact analysis is still hard. A query change can touch public types, compiler, lowerer, executor, provider capabilities, docs, and tests. A Nuxt module change can affect runtime config, generated types, imports, server handlers, prerender, search, sitemap, and agent routes. Large files make it unclear where a small change belongs.

### What 10/10 Means

Junior understandability is 10/10 when a junior can safely make small changes after reading onboarding docs and following test failures. They should know which file to edit, which test to run, and what not to touch.

In this codebase, 10/10 would look like:

- one-page maps for query, provider, module setup, rendering, and CMS contract.
- file names match concepts.
- tests live near contract concepts.
- old/internal paths are not visible enough to confuse contributors.
- common changes have cookbook-style instructions.

### Refactors to Reach 10

1. Add contributor maps.

Create:

- `packages/content/docs/QUERY_PIPELINE.md`
- `packages/content/docs/PROVIDER_CONTRACT.md`
- `packages/content/docs/MODULE_SETUP.md`
- `packages/content/docs/RENDERING.md`
- `packages/content/docs/CMS_CONTRACT.md`

Acceptance criteria:

- each doc explains "change X here, test Y, do not touch Z."
- onboarding links to these maps.

2. Add test command hints to docs.

Acceptance criteria:

- every common change type lists focused tests and broad gate.
- examples: query operator, provider method, parser, renderer, sitemap, generated types.

3. Remove confusing legacy/internal query naming.

Acceptance criteria:

- juniors see only the unified API in docs and public exports.
- internal names are clearly marked internal and not exported through public aliases.

## 5. Typing and Type Safety

### Current: 7/10

The public query types are ambitious and useful. Field types influence allowed operators and values. Collection handles improve inference. Runtime config and provider types are mostly explicit.

The score is 7 because boundary types are too broad:

- `ContentQueryBuilderParams` has `[key: string]: unknown`.
- provider query returns a broad union.
- renderer/composable boundary code uses `any` heavily.
- query-executor uses `compileWhere(condition as never)`.
- generated type declarations manually augment dist paths.
- schema walking in CMS contract necessarily uses `unknown`, but needs strong validation tests.

### What 10/10 Means

Typing is 10/10 when types prevent incorrect usage at public boundaries and make invalid internal states hard to represent. Casts exist only at real untyped framework boundaries and are isolated in small adapters.

In this codebase, 10/10 would look like:

- provider result types are discriminated and exact.
- query transport params are closed over known fields.
- public query options and internal execution plans are separate types.
- Vue renderer `any` is isolated behind named boundary types.
- generated type declarations have tests that compile representative consumer code.

### Refactors to Reach 10

1. Close `ContentQueryBuilderParams`.

Add explicit fields:

- `resolveVariant`
- `resolveLocale`
- `navigationFields`
- `canonical`
- terminal flags

Remove `[key: string]: unknown`.

Acceptance criteria:

- typecheck passes without broad index signature.
- no `as never` needed in `query-executor.ts`.

2. Split `types/query.ts`.

Target files:

- `types/query/public.ts`
- `types/query/transport.ts`
- `types/query/results.ts`
- `types/query/populate.ts`
- `types/query/navigation.ts`
- `types/query/index.ts`

Acceptance criteria:

- public imports stay stable through barrel exports.
- internal modules import transport types from transport file, not public options.

3. Replace provider result union.

Acceptance criteria:

- provider authors cannot accidentally return a list where count is expected.
- malformed return tests fail before normalization.

4. Name framework boundary types.

Examples:

- `MarkdownRendererComponentRegistry`
- `MarkdownRendererProps`
- `ContentHeadInput`
- `ContentApiFetchResult`

Acceptance criteria:

- `Record<string, any>` appears only in explicit framework boundary files.
- no `any` in core/features/storage except justified schema-introspection spots.

## 6. Error Handling

### Current: 6/10

Storage validation and provider module errors are stronger than the first review implied. `ContentError`, `ContentProviderError`, and H3 `createError` cover many paths.

The score is 6 because expected failures still use mixed styles:

- raw `TypeError` for invalid handles and some query operator misuse.
- generic `Error` in parser failures, sitemap site URL failure, navigation-disabled helper, and cache adapters.
- silent provider response coercion can hide provider bugs.
- not all user-facing errors carry stable codes.

### What 10/10 Means

Error handling is 10/10 when every expected failure has a stable code, actionable message, and consistent boundary mapping. Unexpected failures can still throw normal errors, but invalid user/provider/content input should be structured.

In this codebase, 10/10 would look like:

- content author mistakes use `ContentError`.
- provider contract mistakes use `ContentProviderError`.
- public API misuse uses a small `ContentApiUsageError` or provider error where appropriate.
- HTTP handlers map errors consistently.
- provider result validation fails loudly.

### Refactors to Reach 10

1. Inventory expected errors.

Create a table:

- invalid collection handle
- unsupported operator
- malformed provider module
- malformed provider result
- invalid CSV
- missing site URL in production
- invalid populate target
- disabled navigation/search/revalidation

Acceptance criteria:

- each expected error has a code and owner.

2. Add error helpers.

Do not create a huge error framework. Add small helpers:

- `createContentUsageError`
- `createProviderShapeError`
- `createParserError` if parser errors need user-facing codes.

Acceptance criteria:

- raw `Error`/`TypeError` remains only for truly unexpected internal failures.

3. Validate provider returns.

Acceptance criteria:

- malformed provider result tests assert stable error codes.
- no silent fallback to count `0` for malformed count responses.

## 7. Testability

### Current: 8/10

Tests are a strength. There are contract, unit, provider, runtime, client, Nuxt, and e2e projects. Architecture and package export tests are valuable. Integration hook tests cover tricky sitemap/prerender behavior.

The score is 8 because some high-risk areas are still hard to test directly:

- `module.ts` side effects and hooks.
- generated type declaration contents.
- malformed provider return shapes.
- public agent markdown/server exports.
- doctor rule organization.

### What 10/10 Means

Testability is 10/10 when core logic is deterministic, side effects are isolated, public contracts are tested, and generated artifacts have drift tests.

In this codebase, 10/10 would look like:

- module setup is mostly tested through focused registration helpers.
- generated declarations have snapshot/contract tests.
- provider fixture tests cover invalid providers and invalid result returns.
- agent markdown public facade has dedicated tests.
- type-level tests prove generated collection inference.

### Refactors to Reach 10

1. Add provider malformed-return tests.

Cases:

- count query returns array.
- list query returns number.
- first query returns array without explicit envelope.
- envelope misses `total`.
- envelope `result` has wrong type.

2. Add generated declaration tests.

Acceptance criteria:

- `registerGeneratedTypes` output is tested for `#content/server`.
- consumer fixture typecheck proves collection map inference.

3. Add module helper tests after splitting.

Acceptance criteria:

- search prerender helper is tested without Nuxt module setup.
- agent prerender helper is tested without full Nitro build.

4. Add docs/operator drift tests.

Acceptance criteria:

- docs list every provider-advertised public query operator.
- provider capabilities, public query types, and docs stay synchronized.

## 8. Documentation

### Current: 8/10

Docs are already strong: README, package README, public docs, examples, playgrounds, architecture, onboarding, ADRs. The onboarding guide is particularly good.

The score is 8 because the missing docs are exactly where contributors and provider authors can break contracts:

- provider return shapes.
- unified query pipeline.
- generated type surface.
- error code map.
- module setup internals.
- agent markdown public/private boundary.

### What 10/10 Means

Documentation is 10/10 when a user can use the public API without reading internals, and a contributor can make common changes by following written paths and tests.

In this codebase, 10/10 would look like:

- provider contract docs are precise enough to implement a provider correctly.
- architecture docs include examples of wrong layer placement.
- generated types and aliases are documented.
- error codes and failure modes are documented.
- migration/doctor rules explain why each rule exists.

### Refactors to Reach 10

1. Write `PROVIDER_CONTRACT.md`.

Must include:

- capabilities.
- required methods.
- exact query return envelopes.
- cache result wrapping.
- error codes.
- minimal provider example.
- invalid examples.

2. Write `QUERY_PIPELINE.md`.

Must include:

- public options.
- compile params.
- lower plan.
- provider dispatch.
- normalize response.
- decorate localization.
- populate references.

3. Write `GENERATED_TYPES.md`.

Must include:

- `ContentCollectionMap`
- `ContentCollectionI18nMap`
- `#content/server`
- when generated types rebuild.
- how to debug bad inference.

4. Add error-code docs.

Acceptance criteria:

- every `ContentErrorCode` and `ContentProviderErrorCode` appears in docs with cause and fix.

## 9. Dependency and Configuration Design

### Current: 6/10

The dependency set is plausible for a Nuxt content module, but heavy. Runtime dependencies include Comark, Nuxt kit, H3, Nitro, MiniSearch, Pagefind, Shiki, unstorage, `ws`, parsers, and Zod. Some are optional by feature but installed as dependencies.

Configuration defaults are sensible but centralized in `module.ts`. Runtime config sanitization is good, but config ownership is spread across module defaults, `module/options.ts`, `module/runtime-config.ts`, runtime app parsing, and server runtime parsing.

### What 10/10 Means

Dependency/config design is 10/10 when optional features do not burden default users unnecessarily, config defaults have one source of truth, runtime config is validated, and feature config is normalized once.

In this codebase, 10/10 would look like:

- default options live in a focused module.
- runtime config schema is explicit.
- search/pagefind/shiki/ws dependencies are justified or optional-loaded.
- config normalization happens once and is reused by client/server.
- docs explain which features pull which dependencies.

### Refactors to Reach 10

1. Extract defaults.

Target:

- `module/defaults.ts`

Acceptance criteria:

- `module.ts` imports defaults.
- tests assert default options.

2. Audit runtime dependencies.

Questions:

- Does `pagefind` need to be a dependency or optional peer/dynamic path?
- Does `ws` need to be runtime dependency?
- Can Shiki/default themes stay optional until highlight is used?
- Are Nuxt/Nitro/H3 dependency versions appropriate as dependencies vs peers?

Acceptance criteria:

- each dependency has a documented owning feature.
- optional feature dependencies are lazy-loaded where practical.

3. Validate runtime config shape.

Acceptance criteria:

- runtime config parser validates expected fields.
- invalid runtime config fails with clear error in dev/build.

## 10. Consistency

### Current: 7/10

Naming and file organization are mostly consistent in core and tests. Query pipeline names are good. Provider capability naming is clear.

The score is 7 because conventions vary at boundaries:

- raw errors vs typed errors.
- public facade exports vs runtime re-exports.
- `any` in some internal files and `unknown` in others.
- old/internal query helpers next to unified API.
- environment checks in feature code.
- generated public declarations without matching public export tests.

### What 10/10 Means

Consistency is 10/10 when similar concepts are handled the same way everywhere. A contributor should not have to ask which error style, export style, typing style, or test style applies.

In this codebase, 10/10 would look like:

- one expected-error convention per layer.
- one provider return convention.
- one query API convention.
- one generated-type testing convention.
- one docs update rule for public operators/capabilities.

### Refactors to Reach 10

1. Create conventions doc.

Sections:

- errors.
- public exports.
- provider contracts.
- generated files.
- tests.
- type assertions.

2. Add lint/test guards where practical.

Acceptance criteria:

- no new `runtime` imports in lower layers.
- no new public runtime re-exports without package export tests.
- no new provider operator without docs/type/capability tests.

3. Normalize error conventions.

Acceptance criteria:

- expected user/provider/content failures use stable codes.
- tests assert codes, not only messages.

## 11. Long-Term Maintainability

### Current: 7/10

The long-term base is good: architecture docs, ADRs, contract tests, examples, release verification, and an explicit provider contract. The risk is uncontrolled surface growth. The library already owns parsing, rendering, query, routes, localization, navigation, search, sitemap, cache hints, provider contracts, CMS contract helpers, agent markdown, Nuxt module setup, generated types, docs, examples, and doctor tooling.

The score is 7 because this is a lot for one package, and several central files are already near the point where future changes will be painful.

### What 10/10 Means

Long-term maintainability is 10/10 when the package can grow without central files becoming dumping grounds and without public API ambiguity. New features should slot into existing ownership boundaries with focused tests and docs.

In this codebase, 10/10 would look like:

- every major feature has an owner directory and contract tests.
- public API growth requires a documented export and test update.
- internal derived paths are marked and invariant-tested.
- large files have been split around stable concepts.
- optional features do not force broad dependency/config churn.

### Refactors to Reach 10

1. Establish feature ownership map.

Map each feature to:

- source owner.
- public API owner.
- docs owner.
- tests owner.
- generated artifact owner if any.

2. Add public API change checklist.

Checklist:

- package export test.
- generated type test.
- docs update.
- semver/changelog note.
- migration note if breaking.

3. Track derived paths.

Examples:

- prerender route discovery from filesystem content.
- generated type declarations.
- search indexes.
- sitemap entries.
- CMS contract artifacts.

Acceptance criteria:

- each derived path has a rebuild story and invariant tests.

## Proposed Execution Order

### Phase 1: Tighten Contracts

1. Provider query result contract.
2. Provider malformed-return tests.
3. Error code cleanup for expected provider/query misuse.
4. Provider contract docs.

Why first: provider contracts are a source of truth. Tightening them reduces ambiguity before splitting files.

### Phase 2: Split Boundary Files

1. Split `module.ts`.
2. Extract search/agent prerender helpers.
3. Split `runtime/query/unified.ts`.
4. Split `use-content.ts`.

Why second: after contracts are stable, structural refactors are safer and easier to verify.

### Phase 3: Derived State and Generated Types

1. Fix or document derived prerender ingest.
2. Add generated declaration tests.
3. Audit `#content/server` as public API.
4. Add docs for generated types.

Why third: these are hidden sources of truth and should be made explicit once the main boundaries are clean.

### Phase 4: Docs and Onboarding

1. Query pipeline doc.
2. Module setup doc.
3. Error code docs.
4. Dependency feature ownership doc.
5. Update onboarding links.

Why fourth: docs should reflect the cleaned architecture, not the current transitional shape.

### Phase 5: Dependency and Optional Feature Audit

1. Audit runtime dependencies.
2. Lazy-load optional feature dependencies where practical.
3. Validate runtime config shape.
4. Document dependency ownership.

Why fifth: dependency work can create churn; do it after architecture and contracts are less ambiguous.

## Definition of Done for "Near 10"

The library is near 10/10 when:

- no source file over 400 lines exists without a written justification.
- `module.ts`, `runtime/query/unified.ts`, and `use-content.ts` are split.
- provider query return shape is strict and documented.
- malformed provider returns fail with stable error codes.
- generated type declarations are contract-tested.
- public server exports are curated and documented.
- derived prerender/sitemap content discovery is either canonical or invariant-tested.
- expected error paths use stable codes.
- docs explain query pipeline, provider contract, generated types, and module setup.
- focused tests and `pnpm verify` pass.

## Final Recommendation

The highest leverage path is not a broad rewrite. It is a sequence of hard-cut, contract-preserving refactors:

1. tighten provider query results.
2. split the boundary files.
3. eliminate or explicitly test derived ingest paths.
4. curate public exports.
5. document the now-clean contracts.

That path moves the library toward 10/10 without adding speculative abstractions or parallel systems.
