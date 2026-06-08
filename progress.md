# Refactor Progress

This file tracks progress toward the full `refactor-v2.md` maintainability refactor.

## Goal

Fully refactor `@lupinum/ginko-content` according to `refactor-v2.md`, keeping public API, docs, tests, provider contracts, i18n metadata, generated assets, and large-file boundaries aligned.

## Current Status

Status: complete.

The planned refactor work is implemented and verified at focused gates. The storage-boundary question is resolved as an explicit architecture decision: `packages/content/src/storage/*` is the default filesystem/Nitro storage bridge, not a runtime-neutral layer. Boundary tests now enforce the actual rule: runtime-neutral layers stay framework-free, storage cannot import `runtime`, `module`, public facades, or CLI code, and `storage/validation.ts` remains framework-free.

## Phase Checklist

| Phase | Status | Notes |
|---|---|---|
| Phase 1: Stop Public API And Docs Drift | Complete | Consumer validation changed the route-page target to handle-first `useContentPage`; docs drift and docs build are verified. |
| Phase 2: Lock The Public Surface | Complete | Added structured public-surface classification with category, audience, and docs target for package exports, client/server facades, and generated app auto-imports. Removed premature `useContentLocaleSwitch` from public/client/auto-import surfaces. |
| Phase 3: Harden Query And Provider Boundaries | Complete | `ContentProvider.query` now returns only canonical `ContentQueryResponse<T>` envelopes; raw arrays, documents, numbers, and `undefined` are rejected with `provider_result_invalid`. |
| Phase 4: Type The Localized/I18n Result Model | Complete | `LocalizedContentDocument` is a concrete public route/locale metadata type, and query helpers use typed localized fields instead of repeated `unknown` casts for variants/neighbors. |
| Phase 5: Split Large Boundary Files | Complete | Runtime query, module setup, composable facade, doctor entry, integration hooks, query type coordinators, and static-output route discovery helpers are split into focused files. |
| Phase 6: Generated Assets, Config, And Dependency Boundaries | Complete | Generated declarations, defaults, config contracts, runtime-neutral boundary tests, and explicit storage-bridge boundary tests are in place. |
| Phase 7: Contributor Ergonomics And Onboarding | Complete | Added subsystem guides, change recipes, focused test commands, and PR checklist under `packages/content/docs`. |

## Decisions Made

- Keep `useContentPage`, but refine it as the official route-page wrapper over `useContentOne(handle, { by: { route } })`.
- Prefer collection handles in public docs and examples.
- Keep raw string collection names as a dynamic escape hatch with weaker typing, not as the primary docs path.
- Keep `useContentMany`, `useContentOne`, `useContentNavigation`, `useContentSearch`, `useContentVariants`, `ContentRenderer`, and agent APIs, but refine/segment their public surfaces as described in `refactor-v2.md`.
- Keep `useContentSwitchLocalePath` as compatibility API for now because `shadcn-starter-i18n` uses it in active locale-switch fallback logic; replace only after a tested higher-level locale-switch API exists.
- Do not export `useContentLocaleSwitch`; it was removed because no downstream-shaped contract proves it replaces the real consumer's route-switching glue.
- Remove old fluent query vocabulary from active public docs and keep it only in migration/doctor contexts.

## Work Log

### 2026-06-07

- Created `progress.md`.
- Started Phase 1 by auditing current `useContentPage`, stale query API, and docs drift references.
- Confirmed `useContentPage` already accepts collection handles through `ContentCollectionTarget`.
- Updated `refactor-v2.md` to remove the old `useContentOne`-only route-page target and make handle-first `useContentPage` the beginner route-page story.
- Updated package README, docs app route files, core getting-started/querying/rendering/i18n/composables docs, and canonical examples to prefer collection handles.
- Removed stale `Content V2` wording from navigation example content.
- Added a docs-drift guard that rejects raw string `useContentPage('...')` examples outside migration docs.
- Verification: `pnpm vitest run test/unit/docs-drift.test.ts` passed.
- Marked ADR-0005 as superseded by ADR-0016 so old query API names are historical rather than active guidance.
- Verification: `pnpm docs:build` passed after updating live docs app route files.
- Aligned `meta/skill/references/public-surface.md` and `meta/skill/references/module-config.md` with the actual client/server facade and runtime auto-import surfaces.
- Updated active docs and migration target examples for `useContentNavigation` and `useContentSearchData` to use collection handles.
- Kept the remaining raw-string search mention only as historical "code shaped like this" migration context.
- Tightened docs drift coverage so app-facing helpers (`useContentPage`, `useContentNavigation`, `useContentSearchData`) prefer handles unless a line is clearly historical migration context.
- Verification: `pnpm vitest run test/unit/docs-drift.test.ts` passed after the stricter helper guard.
- Verification: `pnpm docs:build` passed after migration/search/navigation docs updates.
- Audited `/Users/matthias/Git/workspace/shadcn-starter-i18n` as a real consumer and updated `refactor-v2.md` with a source-backed keep/remove/refine matrix.
- Confirmed current consumer usage of config APIs, app composables, search, renderer, agent raw path helpers, server agent serializers, and localized route switching.
- Corrected the locale-switch decision: do not remove `useContentSwitchLocalePath` now; classify it as compatibility API until a replacement can cover the consumer's docs/blog/services/references/legal route patterns.
- Rechecked `/Users/matthias/Git/workspace/shadcn-starter-i18n` during the active refactor and confirmed the keep/remove/refine answers in `refactor-v2.md` still match source usage: keep `useContentPage`, `useContentOne`, `useContentMany`, `useContentNavigation`, `useContentSearch`, `useContentVariants`, `ContentRenderer`, config-side agent APIs, server agent markdown serializers, and `agentRawPathForRoute`; keep raw string collection names as a weaker dynamic input; remove old fluent query APIs from active public docs/surfaces; refine or segment locale-switch and agent surfaces instead of deleting them.
- Rechecked the downstream consumer's concrete source files: `nuxt.config.ts` registers the module and configures content i18n/search/markdown; `content.config.ts` uses collection/config/agent helpers; docs and blog pages use `useContentPage`; feature pages use `useContentOne`/`useContentMany`; docs navigation uses `useContentNavigation`; command-center search uses `useContentSearch`; copy-markdown UI uses `agentRawPathForRoute`; server utilities use agent markdown serializers. These usages confirm the keep/remove/refine matrix in `refactor-v2.md`.
- Started Phase 2 public-surface locking by adding exact source-level contract tests for `packages/content/package.json` export subpaths and the value exports from `packages/content/src/public/client.ts` and `packages/content/src/public/server.ts`.
- Fixed generated `#content/server` types so `getCollectionPath` is declared when it is registered as a server auto-import.
- Added a runtime-assets contract that compares registered server auto-imports with generated `#content/server` declarations.
- Updated `meta/skill/references/public-surface.md` so committed export docs include CMS and testing subpaths.
- Verification: `pnpm vitest run test/contracts/package-exports-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts` passed.
- Verification: `git diff --check` passed.
- Added `meta/public-surface.json` as the machine-readable classification for package export subpaths and public client/server facade value exports.
- Updated package export contract tests to derive expected package/client/server exports from `meta/public-surface.json` instead of duplicated arrays in the test file.
- Added a classification-category contract so new public export categories must be explicit and reviewable.
- Updated `meta/skill/references/public-surface.md` to point contributors to `meta/public-surface.json`.
- Verification: `pnpm vitest run test/contracts/package-exports-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts` passed after classification wiring.
- Verification: `git diff --check` passed after classification wiring.
- Extended `meta/public-surface.json` to classify public client/server type-only exports as well as value exports.
- Extended package export contract tests to parse `export type { ... }` blocks and inline mixed `type` exports from the public facades.
- Verification: `pnpm vitest run test/contracts/package-exports-contracts.test.ts` passed after type export classification.
- Added ADR-0018 to document the public-surface classification decision and the current `/server` compatibility-facade policy.
- Added classification category guidance to `meta/skill/references/public-surface.md` so contributors can choose categories without reading internals.
- Updated docs-drift tests so `useContentSwitchLocalePath` is treated as compatibility-only rather than removed, and so beginner docs do not teach advanced provider/cache/agent surfaces.
- Verification: `pnpm vitest run test/unit/docs-drift.test.ts test/contracts/package-exports-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts` passed after ADR/category/drift updates.
- Verification: `jq empty meta/public-surface.json` passed.
- Verification: `git diff --check` passed after ADR/category/drift updates.
- Started Phase 3 provider boundary hardening by adding `provider_result_invalid` as a typed provider error.
- Hardened `normalizeProviderQueryResponse` so count queries reject arrays, list queries reject numbers and malformed list envelopes, and first queries reject array/number mode mismatches instead of silently normalizing them.
- Preserved raw document object behavior for non-envelope objects such as records with a real `result` content field.
- Added provider fixture conformance coverage for malformed provider query result shapes.
- Updated provider API docs and provider skill references to include `provider_result_invalid`.
- Verification: `pnpm vitest run test/contracts/provider-fixture-conformance.test.ts test/contracts/provider-contracts.test.ts test/runtime/provider-result-boundary.test.ts test/contracts/app-query-contracts.test.ts test/unit/docs-drift.test.ts` passed after provider result hardening.
- Verification: `git diff --check` passed after provider result hardening.
- Hardened the HTTP query API handler so it decodes query params once and normalizes provider query responses through `normalizeProviderQueryResponse`, matching the server facade boundary.
- Added API provider boundary coverage proving the handler wraps raw provider arrays into query envelopes and rejects malformed provider results with `provider_result_invalid`.
- Confirmed existing query transport contracts already cover malformed encoded `_params` values.
- Verification: `pnpm vitest run test/runtime/api-provider-boundary.test.ts test/contracts/provider-fixture-conformance.test.ts test/contracts/provider-contracts.test.ts test/runtime/provider-result-boundary.test.ts test/contracts/app-query-contracts.test.ts` passed after API handler normalization.
- Verification: `git diff --check` passed after API handler normalization.
- Started Phase 4 localized result typing by adding `LocalizedContentDocument` as the explicit public alias for `LocalizedDoc`.
- Exported `LocalizedContentDocument` from both public client and server facades and classified it in `meta/public-surface.json`.
- Strengthened type fixture probes for localized documents: `resolved.availableLocales`, `resolved.fallbackLocale`, `LocalePathEntry`, `localePaths` entry shape, and `ContentVariant` result shape.
- Updated active i18n docs to use `page.resolved.*` instead of private `_requestedLocale`, `_resolvedLocale`, and `_fallback` fields.
- Added a docs-drift guard that rejects private locale metadata in active docs/examples outside historical migration context.
- Verification: `pnpm vitest run test/unit/docs-drift.test.ts test/contracts/package-exports-contracts.test.ts` passed after localized metadata docs/type export updates.
- Verification: `pnpm typecheck:source` passed after localized metadata type updates.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after localized metadata type updates.
- Verification: `pnpm docs:build` passed after localized metadata docs updates.
- Verification: `jq empty meta/public-surface.json` passed after localized metadata type updates.
- Verification: `git diff --check` passed after localized metadata type updates.
- Started Phase 5 large boundary file splitting with a narrow extraction from `packages/content/src/runtime/query/unified.ts`.
- Moved transport response envelope unwrapping helpers into `packages/content/src/runtime/query/responses.ts`.
- Added `test/contracts/query-response-contracts.test.ts` to document one/list/find/count unwrapping behavior independently of the larger unified query tests.
- Verification: `pnpm vitest run test/contracts/query-response-contracts.test.ts test/contracts/app-query-contracts.test.ts test/contracts/query-contracts.test.ts test/runtime/api-provider-boundary.test.ts` passed after query response extraction.
- Verification: `pnpm typecheck:source` passed after query response extraction.
- Verification: `git diff --check` passed after query response extraction.
- Moved `ContentQueryContext`, `ContentQueryEndpoint`, and `RuntimeContentConfig` into `packages/content/src/runtime/query/context.ts` while preserving type re-exports from `runtime/query/unified.ts`.
- Moved localized document decoration and navigation-root path helpers into `packages/content/src/runtime/query/localized-docs.ts`.
- Reduced `packages/content/src/runtime/query/unified.ts` from 888 lines to 798 lines after the second Phase 5 extraction.
- Verification: `pnpm vitest run test/contracts/query-response-contracts.test.ts test/contracts/app-query-contracts.test.ts test/contracts/query-contracts.test.ts test/runtime/api-provider-boundary.test.ts` passed after query context/localized-doc extraction.
- Verification: `pnpm typecheck:source` passed after query context/localized-doc extraction.
- Moved collection-handle name validation into `packages/content/src/runtime/query/handles.ts`.
- Moved reference populate validation, populated select expansion, and populated document materialization into `packages/content/src/runtime/query/populate.ts`.
- Reduced `packages/content/src/runtime/query/unified.ts` from 798 lines to 641 lines after the reference population extraction.
- Verification: `pnpm vitest run test/ginko-unified-populate.test.ts test/contracts/app-query-contracts.test.ts test/contracts/query-contracts.test.ts` passed after reference population extraction.
- Verification: `pnpm typecheck:source` passed after reference population extraction.
- Verification: `git diff --check` passed after reference population extraction.
- Moved backlink source normalization, reference candidate generation, inferred backlink field resolution, backlink where compilation, and missing-field errors into `packages/content/src/runtime/query/backlinks.ts`.
- Kept `packages/content/src/runtime/query/unified.ts` as the operation coordinator by passing `one` and `many` resolvers into the extracted backlink module, avoiding a circular import.
- Reduced `packages/content/src/runtime/query/unified.ts` from 641 lines to 522 lines after the backlink extraction.
- Verification: `pnpm vitest run test/ginko-unified-populate.test.ts test/contracts/app-query-contracts.test.ts test/contracts/query-contracts.test.ts test/client/consumer-flows.test.ts` passed after backlink extraction.
- Verification: `pnpm typecheck:source` passed after backlink extraction.
- Verification: `git diff --check` passed after backlink extraction.
- Moved `fallback: "default"` resolution into `packages/content/src/runtime/query/locale-options.ts`.
- Moved navigation select fields, `tree`, and `neighbors` implementation details into `packages/content/src/runtime/query/navigation.ts`, while preserving `navigationSelectFields` re-export from `runtime/query/unified.ts`.
- Kept `packages/content/src/runtime/query/unified.ts` as the operation coordinator by passing `one` and `tree` resolvers into the extracted neighbors implementation.
- Reduced `packages/content/src/runtime/query/unified.ts` from 522 lines to 426 lines after the navigation extraction.
- Verification: `pnpm vitest run test/ginko-unified-query.test.ts test/client/consumer-flows.test.ts test/contracts/app-query-contracts.test.ts test/contracts/query-contracts.test.ts` passed after navigation extraction.
- Verification: `pnpm typecheck:source` passed after navigation extraction.
- Verification: `git diff --check` passed after navigation extraction.
- Moved shared query not-found detection into `packages/content/src/runtime/query/errors.ts`.
- Moved pagination limit/skip normalization, count fallback query behavior, page envelope assembly, and paginated population into `packages/content/src/runtime/query/pagination.ts`.
- Reduced `packages/content/src/runtime/query/unified.ts` from 426 lines to 348 lines after the pagination extraction.
- Verification: `pnpm vitest run test/ginko-unified-populate.test.ts test/contracts/app-query-contracts.test.ts test/contracts/query-contracts.test.ts test/client/consumer-flows.test.ts` passed after pagination extraction.
- Verification: `pnpm typecheck:source` passed after pagination extraction.
- Verification: `git diff --check` passed after pagination extraction.
- Extended `packages/content/src/runtime/query/locale-options.ts` with collection locale resolution for operation modules.
- Moved variant locale selection and variant path assembly into `packages/content/src/runtime/query/variants.ts`.
- Reduced `packages/content/src/runtime/query/unified.ts` from 348 lines to 309 lines after the variants extraction.
- Verification: `pnpm vitest run test/client/consumer-flows.test.ts test/ginko-unified-query.test.ts test/contracts/app-query-contracts.test.ts test/contracts/query-contracts.test.ts` passed after variants extraction.
- Verification: `pnpm typecheck:source` passed after variants extraction.
- Verification: `git diff --check` passed after variants extraction.
- Moved `resolveOne`, `one`, and `many` implementation details plus resolution explanations into `packages/content/src/runtime/query/documents.ts`.
- Kept `packages/content/src/runtime/query/unified.ts` as the compatibility/coordinator entrypoint for query operations.
- Reduced `packages/content/src/runtime/query/unified.ts` from 309 lines to 198 lines after the document operation extraction, satisfying the Phase 5 runtime-query target of a small coordinator under 250 lines.
- Verification: `pnpm vitest run test/ginko-unified-populate.test.ts test/client/consumer-flows.test.ts test/ginko-unified-query.test.ts test/contracts/app-query-contracts.test.ts test/contracts/query-contracts.test.ts` passed after document operation extraction.
- Verification: `pnpm typecheck:source` passed after document operation extraction.
- Verification: `git diff --check` passed after document operation extraction.
- Started the composable split by moving reactive option unwrapping, stable async-data key generation, and collection-name resolution into `packages/content/src/runtime/app/composables/use-content-shared.ts`.
- Reduced `packages/content/src/runtime/app/composables/use-content.ts` to 754 lines after the shared helper extraction.
- Verification: `pnpm vitest run test/contracts/use-content-page-contracts.test.ts test/contracts/app-query-contracts.test.ts test/fixtures/typecheck/types/ginko-api.ts` passed after shared composable helper extraction.
- Verification: `pnpm typecheck:source` passed after shared composable helper extraction.
- Verification: `git diff --check` passed after shared composable helper extraction.
- Moved `ContentNavigationNode`, normalized navigation node IDs, first-page lookup, and path collection into `packages/content/src/runtime/app/composables/use-content-navigation.ts`.
- Preserved the `ContentNavigationNode` type re-export from `packages/content/src/runtime/app/composables/use-content.ts`.
- Reduced `packages/content/src/runtime/app/composables/use-content.ts` from 754 lines to 716 lines after the navigation helper extraction.
- Verification: `pnpm vitest run test/contracts/app-query-contracts.test.ts test/contracts/use-content-page-contracts.test.ts test/fixtures/typecheck/types/ginko-api.ts` passed after navigation helper extraction.
- Verification: `pnpm typecheck:source` passed after navigation helper extraction.
- Verification: `git diff --check` passed after navigation helper extraction.
- Moved `useContentTree`, `useContentNavigation`, and `useContentNeighbors` into `packages/content/src/runtime/app/composables/use-content-navigation.ts`.
- Kept `packages/content/src/runtime/app/composables/use-content.ts` as the compatibility export point for those composables so auto-import and public client surfaces remain stable.
- Reduced `packages/content/src/runtime/app/composables/use-content.ts` from 716 lines to 617 lines after the navigation composable extraction.
- Verification: `pnpm vitest run test/contracts/app-query-contracts.test.ts test/contracts/use-content-page-contracts.test.ts test/contracts/package-exports-contracts.test.ts test/fixtures/typecheck/types/ginko-api.ts` passed after navigation composable extraction.
- Verification: `pnpm typecheck:source` passed after navigation composable extraction.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after navigation composable extraction.
- Verification: `git diff --check` passed after navigation composable extraction.
- Moved `useContentMany`, `useContentPagination`, `useContentBacklinks`, and `useContentVariants` into `packages/content/src/runtime/app/composables/use-content-list.ts`.
- Kept `packages/content/src/runtime/app/composables/use-content.ts` as the compatibility export point for those composables so auto-import and public client surfaces remain stable.
- Reduced `packages/content/src/runtime/app/composables/use-content.ts` from 617 lines to 446 lines after the list/pagination/backlink/variant composable extraction.
- Verification: `pnpm vitest run test/contracts/app-query-contracts.test.ts test/contracts/package-exports-contracts.test.ts test/fixtures/typecheck/types/ginko-api.ts` passed after list-style composable extraction.
- Verification: `pnpm typecheck:source` passed after list-style composable extraction.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after list-style composable extraction.
- Verification: `git diff --check` passed after list-style composable extraction.
- Moved `useContentOne`, `useContentResolveOne`, and `useContentLocaleSwitch` into `packages/content/src/runtime/app/composables/use-content-document.ts`.
- Moved `UseContentPageOptions`, route matching, not-found normalization, and `useContentPage` into `packages/content/src/runtime/app/composables/use-content-page.ts`.
- Reduced `packages/content/src/runtime/app/composables/use-content.ts` from 446 lines to 37 lines; it is now only the stable public facade used by runtime auto-imports and `#content/client`.
- Current composable implementation file sizes: document 137 lines, page 252 lines, list 182 lines, navigation 147 lines, shared 44 lines.
- Verification: `pnpm vitest run test/contracts/app-query-contracts.test.ts test/contracts/use-content-page-contracts.test.ts test/contracts/package-exports-contracts.test.ts test/fixtures/typecheck/types/ginko-api.ts` passed after document/page composable extraction.
- Verification: `pnpm typecheck:source` passed after document/page composable extraction.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after document/page composable extraction.
- Verification: `git diff --check` passed after document/page composable extraction.
- Moved production static output generation into `packages/content/src/module/static-output.ts`, including search index writing, Pagefind generation, LLM markdown route writes, and raw markdown expansion.
- Reduced `packages/content/src/module.ts` from 720 lines to 561 lines after static output extraction.
- Verification: `pnpm vitest run test/contracts/runtime-assets-contracts.test.ts test/contracts/package-exports-contracts.test.ts test/unit/docs-drift.test.ts` passed after static output extraction.
- Verification: `pnpm typecheck:source` passed after static output extraction.
- Moved Nitro config mutation into `packages/content/src/module/nitro-config.ts`, including prerender cache routes, dev storage, content ignores, route rules, runtime plugins, sitemap integration hooks, and agent prerender routes.
- Reduced `packages/content/src/module.ts` from 561 lines to 469 lines after Nitro config extraction.
- Verification: `pnpm vitest run test/contracts/runtime-assets-contracts.test.ts test/contracts/package-exports-contracts.test.ts test/unit/docs-drift.test.ts` passed after Nitro config extraction.
- Verification: `pnpm typecheck:source` passed after Nitro config extraction.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after module static-output/Nitro extraction.
- Verification: `git diff --check` passed after module static-output/Nitro extraction.
- Moved provider availability checks, removed markdown option validation, collection name validation, and built-in markdown plugin peer dependency validation into `packages/content/src/module/validation.ts`.
- Reduced `packages/content/src/module.ts` from 469 lines to 410 lines after validation extraction.
- Verification: `pnpm vitest run test/contracts/runtime-assets-contracts.test.ts test/contracts/package-exports-contracts.test.ts test/unit/docs-drift.test.ts` passed after module validation extraction.
- Verification: `pnpm typecheck:source` passed after module validation extraction.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after module validation extraction.
- Removed `useContentLocaleSwitch` from runtime implementation, client facade exports, generated app auto-imports, public-surface metadata, docs, and tests.
- Converted `ContentProvider.query` to a strict canonical-envelope contract: list queries return `{ result: T[], skip, limit, total }`, first queries return `{ result: T | undefined }`, and count queries return `{ result: number }`.
- Changed the filesystem provider query executor to return canonical envelopes, and updated provider fixtures, API handlers, server query context, and agent markdown queries to use the same strict shape.
- Extended `meta/public-surface.json` with structured `category`, `audience`, and `docs` metadata and added generated app auto-import coverage.
- Added contracts that public metadata docs targets exist, app-facing runtime imports are documented by name, and `useContentLocaleSwitch` remains absent from public surfaces.
- Replaced the loose localized alias with a concrete `LocalizedContentDocument` type and removed avoidable localized-document casts from variants and neighbor resolution.
- Extracted pure static-output route helpers into `packages/content/src/module/static-output-routes.ts` and added focused unit coverage for raw markdown route discovery and index-route expansion.
- Updated provider docs and API reference so provider authors see the strict envelope contract and invalid raw shapes.
- Verification: `git diff --check` passed after module validation extraction.
- Moved module defaults into `packages/content/src/module/defaults.ts` with `satisfies ModuleOptions`, making defaults a named source of truth.
- Moved Nuxt and Nitro type augmentations into `packages/content/src/module/augmentations.ts`, keeping declaration concerns out of the setup coordinator while preserving the module entry import.
- Moved `modules:done` provider/context finalization into `packages/content/src/module/context-finalization.ts`, including provider hooks, search handler registration, markdown plugin validation, runtime collection projection, cache integrity generation, and runtime config application.
- Reduced `packages/content/src/module.ts` from 410 lines to 230 lines, satisfying the Phase 5 module coordinator size target.
- Verified `packages/content/src/module.ts` no longer contains direct `mkdirSync`, `writeFileSync`, Markdown link parsing, Pagefind writing, or agent route expansion; those responsibilities are in focused module helpers.
- Verification: `pnpm vitest run test/contracts/runtime-assets-contracts.test.ts test/contracts/package-exports-contracts.test.ts test/unit/docs-drift.test.ts` passed after module defaults/augmentations/finalization extraction.
- Verification: `pnpm typecheck:source` passed after module defaults/augmentations/finalization extraction.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after module defaults/augmentations/finalization extraction.
- Verification: `git diff --check` passed after module defaults/augmentations/finalization extraction.
- Started the doctor split by moving shared doctor result/types into `packages/content/src/cli/doctor/types.ts`.
- Moved doctor filesystem helpers into `packages/content/src/cli/doctor/files.ts`, including source file collection, output file collection, optional text reads, package JSON reads, dependency detection, and relative path formatting.
- Moved brace-aware collection/config parsing helpers into `packages/content/src/cli/doctor/parsing.ts`.
- Moved sitemap artifact inspection into `packages/content/src/cli/doctor/sitemap.ts`.
- Moved the full i18n doctor rule group into `packages/content/src/cli/doctor/i18n.ts`.
- Moved doctor output formatting into `packages/content/src/cli/doctor/report.ts` and preserved the existing `formatDoctorResult` re-export from `packages/content/src/cli/doctor.ts`.
- Reduced `packages/content/src/cli/doctor.ts` from 1019 lines to 226 lines; remaining work is to split non-i18n dependency/source/search checks into explicit rule modules and add rule-level naming/severity structure.
- Current doctor implementation file sizes: entry 226 lines, i18n 365 lines, parsing 212 lines, files 111 lines, sitemap 68 lines, types 31 lines, report 28 lines.
- Verification: `pnpm vitest run test/contracts/doctor-contracts.test.ts` passed after the doctor i18n/shared/report split.
- Verification: `pnpm typecheck:source` passed after the doctor i18n/shared/report split.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after the doctor i18n/shared/report split.
- Verification: `git diff --check` passed after the doctor i18n/shared/report split.
- Split `packages/content/src/types/query.ts` into focused query type modules while preserving `packages/content/src/types/query.ts` as the stable source import barrel.
- Added `packages/content/src/types/query-parts/transport.ts` for query builder params, where/sort transport types, immutable query builder interfaces, query requests, fetchers, and match operators.
- Added `packages/content/src/types/query-parts/collections.ts` for generated collection map augmentation types and collection target/name helpers.
- Added `packages/content/src/types/query-parts/results.ts` for route metadata, localized route/path metadata, sitemap entries, search sections, and legacy collection helper option/result types.
- Added `packages/content/src/types/query-parts/public.ts` for the ADR-0016 public query API: selectors, public where/sort specs, population, localized documents, resolve envelopes, one/many/pagination/backlink/variant/tree/neighbor options and results.
- Reduced `packages/content/src/types/query.ts` from 1056 lines to a 7-line barrel; current query type implementation file sizes: public 273 lines, transport 163 lines, results 112 lines, collections 18 lines.
- Kept public/source imports through `../types/query` stable. The emitted build now includes `dist/types/query.d.ts` as a barrel and `dist/types/query-parts/*` declarations for the focused definitions.
- Verification: `pnpm typecheck:source` passed after the query type split.
- Verification: `pnpm vitest run test/contracts/package-exports-contracts.test.ts test/fixtures/typecheck/types/ginko-api.ts test/contracts/app-query-contracts.test.ts test/contracts/query-contracts.test.ts test/contracts/query-response-contracts.test.ts` passed after the query type split.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after the query type split.
- Verification: `git diff --check` passed after the query type split.
- Moved build-time filesystem route discovery and sitemap collection counting out of `packages/content/src/module/integration-hooks.ts` into `packages/content/src/module/derived-route-discovery.ts`.
- Marked route discovery as rebuildable derived state in code: it is derived from content files plus the resolved content context, and its contracts cover localized routes, translated slugs, draft/partial filtering, array collection sources, and sitemap opt-outs.
- Reduced `packages/content/src/module/integration-hooks.ts` from 280 lines to 101 lines; `packages/content/src/module/derived-route-discovery.ts` now owns the 221-line parsing/graph route derivation path.
- Fixed the extracted Nitro integration registration so `nitro:config` can register hooks before `modules:done` without eagerly reading the finalized content context. Hook execution still prefers the finalized context and falls back to the registration context normalized through the existing markdown option processor.
- Verification: `pnpm vitest run test/contracts/integration-hooks-contracts.test.ts test/contracts/sitemap-assert-contracts.test.ts test/contracts/module-contracts.test.ts` passed after the integration hook split and lazy context fix.
- Verification: `pnpm typecheck:source` passed after the integration hook split and lazy context fix.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after the integration hook split and lazy context fix.
- Split the remaining non-i18n doctor checks into named rule modules under `packages/content/src/cli/doctor/rules`: dependency/lockfile checks, public API migration checks, rendering/template checks, static search collection checks, shared source-pattern traversal, and shared constants.
- Reduced `packages/content/src/cli/doctor.ts` from 226 lines to 27 lines; it now only orchestrates rule groups, sorts findings, computes the exit code, and preserves the public `formatDoctorResult` re-export.
- Current doctor implementation file sizes: entry 27 lines, dependency rules 84 lines, public API rules 52 lines, rendering rules 17 lines, search rules 40 lines, source scanner 35 lines, i18n 365 lines, parsing 212 lines, files 111 lines, sitemap 68 lines, report 28 lines, types 31 lines.
- Verification: `pnpm vitest run test/contracts/doctor-contracts.test.ts` passed after the doctor rule-module split.
- Verification: `pnpm typecheck:source` passed after the doctor rule-module split.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after the doctor rule-module split.
- Started Phase 6 by turning generated runtime import/declaration lists into explicit internal sources of truth in `packages/content/src/module/runtime-assets.ts`.
- `registerRuntimeImports` now consumes `runtimeAppImportSpecs` and `runtimeServerImportSpecs` instead of embedding separate hardcoded arrays.
- `registerGeneratedTypes` now derives the generated `#content/server` value/type declarations from `generatedContentServerValueNames` and `generatedContentServerTypeSpecs`, including the generic provider result aliases.
- Extended `test/contracts/runtime-assets-contracts.test.ts` so app auto-import names, server auto-import names, and the complete generated `#content/server` declaration surface cannot drift silently.
- Verification: `pnpm vitest run test/contracts/runtime-assets-contracts.test.ts` passed after generated runtime asset source-list extraction.
- Verification: `pnpm typecheck:source` passed after generated runtime asset source-list extraction.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after generated runtime asset source-list extraction.
- Added `test/contracts/architecture-boundaries.test.ts` to prevent runtime-neutral layers (`core`, `features`, `cms-contract`, `cms-import`) from importing Nuxt, Nitro, Vue, H3, app/runtime/module/integration/public/CLI code.
- Moved `ContentCacheHint` and `ContentCacheHintInput` to `packages/content/src/core/cache-hints.ts`, keeping the public provider facade as a type re-export instead of the source of truth.
- Added `packages/content/src/core/provider-errors.ts` for provider error codes/status metadata and a framework-neutral error object; the public provider-error facade now adapts the core mapping to H3.
- Removed the public facade dependency from `packages/content/src/features/sitemap/query.ts` by using the core provider-error helper.
- Resolved the Phase 6 storage-boundary gap by documenting `packages/content/src/storage/*` as the default filesystem/Nitro storage bridge rather than a runtime-neutral layer.
- Added architecture-boundary coverage proving storage does not import `runtime`, `module`, public facades, or CLI code, and that `storage/validation.ts` stays framework-free.
- Verification: `pnpm vitest run test/contracts/architecture-boundaries.test.ts test/unit/docs-drift.test.ts` passed after the storage-boundary decision and downstream consumer recheck.
- Verification: `pnpm typecheck:source` passed after the architecture contract update.
- Verification: `pnpm docs:build` passed after the docs/plan updates, with existing Nuxt/Rollup build warnings only.
- Verification: `git diff --check` passed after the final edits.
- Verification: `pnpm vitest run test/contracts/architecture-boundaries.test.ts` passed after the boundary contract and import fixes.
- Verification: `pnpm vitest run test/contracts/sitemap-query-contracts.test.ts test/contracts/provider-contracts.test.ts test/contracts/provider-fixture-conformance.test.ts test/contracts/server-reference-contracts.test.ts` passed after moving provider errors/cache hint types.
- Verification: `pnpm typecheck:source` passed after moving provider errors/cache hint types.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after moving provider errors/cache hint types.
- Removed MiniSearch default drift by deriving `contentModuleDefaults.search.minisearch` from `defaultMiniSearchOptions` instead of maintaining a second literal copy.
- Added a runtime config contract that asserts module MiniSearch defaults match the shared MiniSearch defaults source of truth.
- Verification: `pnpm vitest run test/contracts/runtime-config-contracts.test.ts` passed after MiniSearch default consolidation.
- Verification: `pnpm typecheck:source` passed after MiniSearch default consolidation.
- Verification: `pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck` passed after MiniSearch default consolidation.
- Added Phase 7 contributor guides:
  - `packages/content/docs/QUERY_PIPELINE.md`
  - `packages/content/docs/PROVIDER_CONTRACT.md`
  - `packages/content/docs/MODULE_SETUP.md`
  - `packages/content/docs/RENDERING.md`
  - `packages/content/docs/CMS_CONTRACT.md`
  - `packages/content/docs/CHANGE_GUIDE.md`
- Updated `packages/content/docs/ONBOARDING.md` to link the new subsystem guides from the existing contributor entry point.
- The guides document ownership, invariants, public API/provider impact, focused tests, what not to touch, common change recipes, and a PR checklist.
- Verification: `git diff --check` passed after adding the contributor guides.
- Verification: `pnpm vitest run test/unit/docs-drift.test.ts test/contracts/package-exports-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts test/contracts/architecture-boundaries.test.ts test/contracts/runtime-config-contracts.test.ts` passed as the final docs/export/runtime contract set.
- Verification: `pnpm docs:build` passed after docs and docs-drift updates.

## Remaining Phase 1 Work

None for this refactor slice.

## Remaining Phase 2 Work

- Before 1.0, decide whether agent and cache helpers move from the `/server` compatibility facade to explicit agent/cache subpaths.
- If moving advanced helpers, add a release/migration plan instead of silently creating permanent dual public paths.

## Remaining Phase 6 Work

None. The storage decision is now explicit: keep `src/storage` as the default filesystem/Nitro storage bridge and enforce that only pure storage-adjacent files remain framework-free.
