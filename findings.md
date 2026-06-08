# Maintainability Review: `@lupinum/ginko-content`

## Goal

Review the library for long-term maintainability, with separate findings for architecture, public API, readability, typing, errors, tests, documentation, dependencies, consistency, and refactorability.

## Executive Summary

Ginko Content is a serious library with a real architecture, broad tests, and unusually good internal documentation for core query behavior. The strongest parts are the explicit layer model in `packages/content/ARCHITECTURE.md`, contract tests under `test/contracts`, and the provider-neutral query design around `core/query`, `runtime/query/unified.ts`, and `public/*` facades.

The main maintainability risks are concentrated in boundary code. `packages/content/src/module.ts` is too large and owns too many unrelated Nuxt setup concerns. Public facades re-export a lot of runtime implementation directly, especially agent markdown helpers in `packages/content/src/public/server.ts`. Provider query results accept too many shapes, which makes the provider contract convenient but loose. Several important paths still rely on `any`, `unknown`, `as never`, or generic `Error`/`TypeError`, which weakens type and error guarantees for external users and future provider authors.

Overall: good foundation, not yet comfortably simple. The library is production-leaning, but the team should tighten public contracts, split the biggest boundary files, and make provider/error shapes stricter before scaling the surface further.

## Scores

### Architecture: 7/10

The intended architecture is clear. `packages/content/ARCHITECTURE.md` defines `core`, `features`, `storage`, `integrations`, `runtime`, and `public`, and `test/unit/architecture-boundaries.test.ts` enforces key dependency rules such as `core` not importing `runtime` or framework modules. That is a real strength.

The implementation mostly follows it, but the boundaries get blurry at the edges. `packages/content/src/module.ts` mixes Nuxt module defaults, content config loading, provider registry setup, sitemap setup, search route generation, agent markdown prerender generation, file writes, and runtime config application in one 720-line file. The helper functions at `packages/content/src/module.ts:53-123` are agent/prerender-specific but live at the module root.

`packages/content/src/public/server.ts:23-54` also exposes many agent markdown internals directly from `runtime/server/agent-markdown.js` and `runtime/server/agent-site.js`. That makes `runtime` less of a private adapter layer than the architecture document suggests.

### Public API Design: 7/10

The main entry points are reasonably obvious: root module/config exports in `packages/content/src/module.ts:125-126`, client query/composable exports in `packages/content/src/public/client.ts`, and server query exports in `packages/content/src/public/server.ts:8-18`. The unified verbs `one`, `many`, `paginate`, `resolveOne`, `tree`, `neighbors`, `variants`, and `backlinks` are consistent and understandable.

The confusing part is that there are still multiple query eras visible. The package export tests explicitly assert that `serverQueryCollection` and `queryCollection` are no longer public, but `serverQueryCollection` still exists internally in `packages/content/src/runtime/server/provider-query.ts:228-240`. That is acceptable internally, but it creates contributor confusion about which query API is canonical.

The provider API is too permissive. `ContentProvider.query` in `packages/content/src/public/provider.ts:87-90` may return an envelope, array, single document, number, or `undefined`. `normalizeProviderQueryResponse` in `packages/content/src/runtime/server/provider-query.ts:50-84` silently coerces those shapes. This makes providers easier to write, but harder to debug and harder to specify.

### Readability: 7/10

Core query files are readable and well explained. `packages/content/src/core/query/builder.ts` documents the immutable builder model, and `packages/content/src/core/query/execute.ts` explains standard, locale, and variant execution modes. Those comments are useful because they explain why the code exists, not just what it does.

Readability drops in large boundary files. `packages/content/src/runtime/query/unified.ts` is 974 lines and includes response unwrapping, locale decoration, collection handle validation, populate validation, reference population, pagination, tree/navigation handling, variants, neighbors, and backlinks. A junior developer could read individual sections, but the file is too large to reason about as one unit.

`packages/content/src/module.ts` has the same problem. The setup function beginning at `packages/content/src/module.ts:206` orchestrates too many Nuxt concerns. Debugging setup behavior requires understanding options, hooks, Nitro config, static generation, search, sitemap, agent markdown, and runtime config together.

### Junior-Developer Understandability: 6/10

A junior developer would benefit from strong docs and comments. `packages/content/docs/ONBOARDING.md` gives concrete "where does this change go?" guidance, and the architecture test suite gives feedback when dependency direction is violated.

The challenge is impact analysis. A small change to query behavior can flow through `types/query.ts`, `core/query/filter.ts`, `core/query/lower.ts`, `core/query/execute.ts`, provider capabilities, public docs, and contract tests. That is correct for a real provider contract, but the codebase needs more localized entry points for juniors. The 1050-line `packages/content/src/types/query.ts` is especially hard to navigate because public types, internal builder params, query operators, document inference, populate types, and navigation/result types live together.

### Typing / Type Safety: 7/10

The public query typing is ambitious and useful. `packages/content/src/types/query.ts:147-200` maps field types to valid operators and operand types, which prevents many incorrect calls at compile time. Typed collection handles are also a strong design choice.

The weak spots are boundary escape hatches. `ContentQueryBuilderParams` has `[key: string]: unknown` at `packages/content/src/types/query.ts:127-145`, which makes internal transport payloads open-ended. `runtime/query/unified.ts` casts through `unknown` in several places, for example `explainResolution` at `packages/content/src/runtime/query/unified.ts:316` and populate calls at `packages/content/src/runtime/query/unified.ts:349-353`. `query-executor.ts` uses `compileWhere(condition as never)` at `packages/content/src/runtime/server/query-executor.ts:118-120`, which hides a mismatch between normalized internal query conditions and the public query compiler input.

Vue renderer and composable files also use broad `any`/`Record<string, any>` patterns, especially `packages/content/src/runtime/app/components/internal/MarkdownRenderer.ts` and `packages/content/src/runtime/app/composables/head.ts`. Some of this is normal at Vue/rendering boundaries, but it should be contained and documented as boundary parsing.

### Error Handling: 6/10

The error model has a good base. `packages/content/src/core/errors.ts` defines `ContentErrorCode` and `ContentError`, and `packages/content/src/runtime/server/query-executor.ts:27-44` maps content errors to HTTP errors. Provider errors have explicit codes in `packages/content/src/public/provider-errors.ts`.

The inconsistency is that not all expected failures use those typed envelopes. `filesystemProvider.query` throws `TypeError` for `$options` misuse in `packages/content/src/runtime/server/providers/filesystem.ts:46-49`, while `query-executor.ts:84-86` maps the same issue to a 400 `createError`. `runtime/query/unified.ts:326-330` throws a raw `TypeError` for invalid handles, and `runtime/query/unified.ts:382-391` creates a generic `Error` for populate target mismatch. These messages are actionable, but they are not structured.

There are also silent coercions. `normalizeProviderQueryResponse` turns malformed count responses into `{ result: 0 }` at `packages/content/src/runtime/server/provider-query.ts:54-58`, and non-array/non-envelope responses into one-item lists at `packages/content/src/runtime/server/provider-query.ts:72-83`. That can hide provider bugs.

### Testability: 8/10

The test structure is a major strength. `vitest.config.ts` splits tests into unit, provider, contracts-node, runtime, client, nuxt, and e2e projects. `test/contracts/package-exports-contracts.test.ts` protects public exports. `test/unit/architecture-boundaries.test.ts` protects dependency direction. Provider contract tests exist, including `test/contracts/provider-contracts.test.ts` and `test/contracts/filesystem-provider-conformance.test.ts`.

Logic is often separated from side effects in the query core: `core/query/filter.ts`, `lower.ts`, and `execute.ts` are deterministic and directly testable. The hardest code to test is the Nuxt module setup and prerender file generation in `packages/content/src/module.ts`, because behavior is spread across hooks, generated templates, Nitro config mutation, file IO, and local server fetches.

### Documentation: 8/10

User-facing docs are broad: root `README.md`, package `README.md`, docs content under `docs/content/docs`, examples, playgrounds, and `packages/content/docs/ONBOARDING.md`. The onboarding page is particularly useful because it explains where to add parsers, query operators, error codes, and request-scoped state.

The missing docs are provider and failure-mode oriented. `docs/content/docs/9.api-reference/6.providers.md` explains provider basics, but the code currently accepts multiple result shapes. Provider authors need a stricter "return exactly this shape for query/count/first/list" section, with examples of bad returns and the error they should trigger. There should also be a short internal guide for the unified query pipeline: public option -> compiled params -> lowered plan -> executor -> provider normalization -> decorated result.

### Dependency / Configuration Design: 6/10

The package is tightly coupled to Nuxt/Nitro/Vue by design, so the peer/runtime dependency split matters. `packages/content/package.json:92-117` includes many runtime dependencies: Nuxt kit, Nitro/H3, Comark, MiniSearch, Pagefind, Shiki, websocket support, unstorage, parsers, and Zod. Some are clearly required, but `pagefind`, `shiki`, and `ws` can be heavy for consumers who do not use those paths.

The config defaults in `packages/content/src/module.ts:146-204` are sensible, but the default object is large and mixes API, i18n, sitemap, search, source, markdown, CSV, navigation, agent, and experimental options. That makes config harder to audit. `module/options.ts` and related files already help normalize some of this, but the source-of-truth defaults still live in one large module file.

### Consistency: 7/10

Naming is mostly consistent around collection/query/provider concepts. Files such as `core/query/filter.ts`, `lower.ts`, `execute.ts`, and `plan.ts` form a clear pipeline. Tests are consistently grouped.

Inconsistencies remain around error styles and boundary typing. Some invalid inputs become `createError`, some become `ContentProviderError`, some become raw `TypeError`, and some become generic `Error`. Public facades sometimes export stable facade functions and sometimes directly export runtime implementation helpers. Internal query APIs still exist alongside unified query APIs, even when not exported.

### Long-Term Maintainability: 7/10

The codebase has the right maintainability habits: architecture docs, boundary tests, contract tests, release verification scripts, provider capability tests, and clear ADRs in `meta/adr`. That gives the team a good base for long-term change.

The highest risk is surface-area growth. The library already owns parsing, rendering, query, route metadata, search, sitemap, cache hints, provider contracts, agent markdown, Nuxt module wiring, docs, examples, and CMS contract helpers. Without tighter boundaries, more features will accumulate in the already-large `module.ts`, `runtime/query/unified.ts`, `types/query.ts`, and public server exports.

## Top 5 Strengths

1. Clear architecture contract in `packages/content/ARCHITECTURE.md`, backed by `test/unit/architecture-boundaries.test.ts`.
2. Strong query pipeline separation in `core/query/filter.ts`, `lower.ts`, `plan.ts`, and `execute.ts`.
3. Broad contract-oriented test suite under `test/contracts`, including package export and provider conformance checks.
4. Good public API direction with unified query verbs exported from both client and server.
5. Useful contributor onboarding in `packages/content/docs/ONBOARDING.md`, with concrete change walkthroughs.

## Top 5 Maintainability Risks

1. `packages/content/src/module.ts` is a large orchestration file with too many responsibilities.
2. `packages/content/src/runtime/query/unified.ts` centralizes too much query, localization, populate, and navigation behavior.
3. `ContentProvider.query` accepts too many return shapes in `packages/content/src/public/provider.ts:87-90`, and normalization silently hides malformed provider results.
4. Public server exports expose runtime agent implementation helpers directly in `packages/content/src/public/server.ts:23-54`.
5. Error handling is not uniform: typed `ContentError`, provider errors, H3 errors, raw `Error`, and raw `TypeError` all appear in expected failure paths.

## Top 5 Highest-Impact Improvements

1. Split `packages/content/src/module.ts` by concern: defaults/options, Nuxt hooks, search prerender, agent prerender, sitemap wiring, provider registry.
2. Tighten provider query results to one canonical envelope per operation, and make malformed provider responses fail loudly in development/tests.
3. Move agent markdown public exports behind a smaller explicit facade instead of exporting broad runtime internals.
4. Split `packages/content/src/types/query.ts` into public query options, internal builder transport, result/decorated document types, and populate/reference types.
5. Standardize expected failures on typed error codes or a small set of boundary error helpers.

## Specific Refactoring Recommendations

- Extract agent static generation from `packages/content/src/module.ts:58-123` and the non-dev prerender hook into `module/agent-prerender.ts`.
- Extract search static index writing from the `nitro:build:before` hook in `packages/content/src/module.ts` into `module/search-prerender.ts`.
- Keep `module.ts` as a coordinator that calls named registration functions only. It should not parse markdown links, write public files, or know Pagefind details.
- Split `runtime/query/unified.ts` into `response.ts`, `decorate.ts`, `populate.ts`, `pagination.ts`, and operation files. Keep the exported verbs in one barrel if needed.
- Make `normalizeProviderQueryResponse` strict by default. If compatibility is needed for released providers, add a documented deprecation window instead of silently accepting every shape forever.
- Replace direct public exports of `runtime/server/agent-markdown.js` helpers with a curated `public/agent.ts` or fewer named helpers in `public/server.ts`.

## Specific Typing Improvements

- Remove or narrow `[key: string]: unknown` from `ContentQueryBuilderParams` in `packages/content/src/types/query.ts:127-145`. Add explicit optional fields for `resolveVariant` and other known transport fields.
- Replace `compileWhere(condition as never)` in `packages/content/src/runtime/server/query-executor.ts:118-120` with a separate compiler/normalizer that accepts the actual internal condition type.
- Introduce `ProviderQueryEnvelope<T>` and require providers to return that for query calls, instead of `ContentQueryResponse<T> | T[] | T | number | undefined`.
- Move renderer `Record<string, any>` usage into small boundary types such as `MarkdownRendererComponentRegistry` and `MarkdownRendererProps`.
- Add branded or discriminated types for collection names and handles where runtime code currently accepts `ContentCollectionHandle | string`.

## Specific Documentation Improvements

- Add a "Provider return contract" section with exact allowed responses for list, first, count, navigation, search, site data, and cache-wrapped responses.
- Add a "Unified query pipeline" internal doc: `one/many` options -> `compileQueryParams` -> `lowerQueryPlan` -> provider query -> normalization -> localization decoration.
- Add a "Common failure modes" doc for invalid collection names, unsupported operators, invalid refs, duplicate localized paths, malformed provider modules, and bad populate targets.
- Add a "Where public API ends" doc explaining that `public/client.ts` and `public/server.ts` are compatibility commitments but `runtime/*` is not.
- Add a contributor map for `types/query.ts`, or split it first and document the new type files.

## Specific Test Improvements

- Add provider contract tests that intentionally return malformed query shapes and assert that they fail loudly instead of being silently coerced.
- Add tests for raw `TypeError`/generic `Error` paths and then convert them to structured error assertions.
- Add focused module tests for extracted search prerender and agent prerender helpers after splitting `module.ts`.
- Add type-level tests for `ContentQueryBuilderParams` once `resolveVariant` and transport fields are explicit.
- Add docs drift tests for provider capabilities vs docs and public query operator docs, similar to the existing architecture/export contract tests.

## Direct Answers

### Could a junior developer understand this library after reading it for one day?

Partially. They could understand the high-level structure with `ARCHITECTURE.md` and `ONBOARDING.md`, and they could probably make sense of the core query pipeline. They would not fully understand the runtime/module/provider interactions in one day.

### Could a junior developer safely make a small change?

Yes, if the change is localized and covered by an existing contract test pattern, such as a parser tweak, docs update, or small query operator behavior. No, if the change touches `module.ts`, provider normalization, localization, or public exports without close review.

### Could a mid-level developer safely add a new feature?

Yes, for features that fit an existing layer and test pattern. A mid-level developer could add a query operator or parser by following `ONBOARDING.md`. They would need senior review for provider contract changes, public API changes, Nuxt module setup, and i18n route behavior.

### Is the public API clean enough for external users?

Mostly, for the unified query and composable API. The provider API is not clean enough yet because it accepts too many result shapes and exposes broad internal query params. The server export also exposes too many agent/runtime helpers as public API.

### What part of the codebase is most likely to become painful as the library grows?

`packages/content/src/module.ts`, `packages/content/src/runtime/query/unified.ts`, and `packages/content/src/types/query.ts`. They are already large, central files where unrelated responsibilities meet. More features will make them harder to debug and riskier for juniors to edit.

### What should be fixed before this library is considered production-quality?

1. Tighten provider query return contracts and fail loudly on malformed provider responses.
2. Split `module.ts` so Nuxt setup, search prerender, sitemap wiring, and agent prerender are independently testable.
3. Standardize expected error paths on typed errors or explicit boundary helpers.
4. Reduce public exposure of runtime implementation helpers.
5. Narrow internal query transport types so type assertions do not hide real mismatches.

## Verification Notes

This review is based on source inspection. I did not run the full `pnpm verify` gate because the requested deliverable was a findings document, not a code behavior change.

## Deep Review Addendum

### Scope of the Deeper Pass

After the first pass, I reviewed additional source areas that were only sampled before:

- `packages/content/src/storage/*`
- `packages/content/src/features/*`
- `packages/content/src/parsers/*`
- `packages/content/src/cms-contract/*`
- `packages/content/src/cms-import/*`
- `packages/content/src/module/*`
- `packages/content/src/runtime/app/*`
- `packages/content/src/runtime/server/providers/*`
- representative contract tests for providers, runtime config, integration hooks, runtime assets, query contracts, and doctor behavior.

This still is not a literal line-by-line audit of every file in the repository, but it is now based on all major source areas that determine architecture, public API, extension behavior, runtime behavior, and maintainability risk.

### Findings That Held Up

The original high-level findings still hold:

- `packages/content/src/module.ts`, `packages/content/src/runtime/query/unified.ts`, and `packages/content/src/types/query.ts` are the main long-term maintainability hotspots.
- The architecture is real, documented, and partly enforced by tests.
- The unified query API is the cleanest user-facing surface.
- Provider query result shape remains too permissive.
- Public server exports expose too much runtime/agent implementation.
- Boundary files use broad `any`/`unknown`/casts more than core files.

### Corrections and Nuance

Storage validation is stronger than the first review suggested. `packages/content/src/storage/validation.ts:9-17` explicitly documents that expected validator failures return `Result<T, ContentError>`, and most graph/document invariants follow that model. The error inconsistency is therefore mostly a runtime/API/provider-boundary issue, not a storage-layer issue.

Provider module validation is also stronger than the first review implied. `packages/content/src/runtime/server/providers/index.ts` validates provider capability shape and required methods, then wraps providers to enforce capabilities before dispatch. The remaining weakness is after-return validation: `normalizeProviderQueryResponse` still accepts malformed or ambiguous query results too quietly.

Feature modules are generally cleaner than runtime modules. Navigation, localization, search-section, and sitemap helpers are mostly small pure functions with good comments. The exception is `packages/content/src/features/sitemap/query.ts:73-81`, which reads `process.env.NODE_ENV` inside a feature-level helper despite describing itself as a pure implementation. That is a small but real boundary leak.

The CMS contract subpath is intentionally pure and well documented in `packages/content/src/cms-contract/index.ts`. However, `packages/content/src/cms-contract/build.ts` is a large schema-introspection module. The extensive `unknown` handling is defensible because it walks Zod internals, but it is sensitive to Zod changes and needs strong contract coverage.

### Additional Maintainability Risks Found

1. Duplicated ingest behavior for sitemap/prerender discovery.

`packages/content/src/module/integration-hooks.ts:60-123` reparses content files directly with `globby`, `readFile`, `transformContent`, `resolveCollection`, and `expandDataLocaleVariants`. This mirrors the real ingest/storage path rather than reusing a single source of truth. The tests in `test/contracts/integration-hooks-contracts.test.ts` reduce the risk, but this is still a derived path that can drift from runtime content ingestion.

2. Generated type declarations manually mirror public and dist paths.

`packages/content/src/module/runtime-assets.ts:192-238` generates module augmentations for `@lupinum/ginko-content`, `@lupinum/ginko-content/dist/types/query`, `@lupinum/ginko-content/dist/types/query.js`, and `#content/server`. This is powerful, but brittle: changing export paths or type file layout requires updating generated strings and tests.

3. Public facade risk is broader than package exports.

The package export tests protect presence/absence of top-level exports, but the generated `#content/server` surface in `runtime-assets.ts:210-238` is another public-ish API surface. It deserves the same scrutiny as `public/server.ts`.

4. Feature-level environment dependency.

`packages/content/src/features/sitemap/query.ts:73-81` uses `process.env.NODE_ENV` to choose request-site fallback and production failure behavior. This makes a nominally pure feature helper behave differently depending on process state. Pass an explicit `dev`/`production` flag through runtime input instead.

5. Raw/generic errors remain in parsers and feature helpers.

Examples include `packages/content/src/parsers/from-csv.ts` throwing generic `Error` for malformed CSV and `packages/content/src/features/sitemap/query.ts:77-78` throwing generic `Error` for missing production site URL. These are not necessarily bugs, but they are weaker than the structured error model used elsewhere.

6. Runtime app composables duplicate operation scaffolding.

`packages/content/src/runtime/app/composables/use-content.ts` repeats the same pattern for reactive option resolution, stable key generation, context creation, `useAsyncData`, return shaping, and casts across many operations. This is readable section-by-section, but hard to extend safely.

7. The CLI doctor is large and likely deserves its own internal structure review.

`packages/content/src/cli/doctor.ts` is over 1000 lines. It has useful contract tests, but I did not fully inspect every rule. Given its size and role in migration guidance, it should be reviewed as a separate tool with its own rule organization and fixture strategy.

### Additional Strengths Found

1. Provider capability enforcement is centralized.

`packages/content/src/runtime/server/providers/index.ts` validates provider shape and wraps methods so unsupported operations fail before implementation code runs.

2. Revalidation security is more robust than expected.

`packages/content/src/runtime/server/api/revalidate.ts` uses signed payloads, timestamp tolerance, constant-time comparison, optional unsigned token mode, normalized path/tag inputs, and clear H3 error statuses.

3. Runtime config sanitization is intentional.

`packages/content/src/module/runtime-config.ts` strips functions/symbols from public markdown plugin config and keeps revalidation tokens private. The related tests in `test/contracts/runtime-config-contracts.test.ts` are good maintainability guards.

4. Integration hook drift is at least tested.

Even though `module/integration-hooks.ts` duplicates ingest behavior, `test/contracts/integration-hooks-contracts.test.ts` covers localized route counting, array sources, translated slugs, external providers, and sitemap route timing.

5. CMS contract purity is explicit.

`packages/content/src/cms-contract/index.ts` states that this subpath must not import Node, Nuxt, H3, Nitro, filesystem, or Nuxt kit dependencies. That is exactly the kind of boundary statement a maintainer needs.

### Updated Highest-Priority Recommendations

1. Make provider query responses strict.

Keep capability validation, but add return-shape validation. A provider query should return one canonical envelope for list, first, and count. Add contract tests where providers return `{ total: 1 }`, `{ result: 'wrong' }`, a number for a list query, and `undefined` for count.

2. Remove duplicated prerender ingest where possible.

`module/integration-hooks.ts` should call a shared content discovery/ingest helper rather than owning its own filesystem glob/parse/graph path. If this path must remain derived, mark it explicitly as derived and keep invariant tests proving it matches the storage ingest path.

3. Split `use-content.ts` by operation or extract a typed composable runner.

Avoid a clever generic abstraction, but do remove repeated `computed -> stableKey -> useAsyncData -> shaped return` scaffolding where it is identical.

4. Treat generated type declarations as public API.

Add contract tests for the generated `#content/server` declaration contents, not only runtime import registration. Keep `dist/types/query` augmentation only if it is a real compatibility requirement.

5. Push environment decisions to runtime inputs.

Replace `process.env.NODE_ENV` checks in feature helpers with explicit runtime flags so feature functions remain deterministic under test.

### What Else Would Need Exploration for a Fully Exhaustive Opinion

- Full line-by-line audit of `packages/content/src/cli/doctor.ts`.
- Full line-by-line audit of `packages/content/src/runtime/server/agent-markdown.ts` and `agent-site.ts`, especially because many helpers are public server exports.
- Full audit of `packages/content/src/types/config.ts`, `types/module.ts`, `types/content.ts`, and `types/search.ts`.
- Full audit of every test file for brittleness and whether tests assert public behavior rather than implementation details.
- Run `pnpm verify`, `pnpm run release:verify`, and inspect failures, runtime, and generated artifacts.
- Build the package and inspect generated declaration files to see which internal paths leak through public `.d.ts` output.
- Compare docs operator/provider descriptions against `filesystemProvider.capabilities` and `SUPPORTED_QUERY_OPERATORS`.
- Audit dependency bundle impact for optional features: Pagefind, Shiki, MiniSearch, `ws`, Comark plugins, and Nitro/H3 coupling.

### Confidence After Deep Review

Confidence is now high for the maintainability assessment of the main library architecture, query/provider/runtime surfaces, storage validation, docs/test posture, and module integration risks.

Confidence is medium for the CLI doctor and agent markdown surfaces because they are large and only partially inspected in this deeper pass.
