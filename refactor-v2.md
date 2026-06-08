# Refactor V2: Final Maintainability Plan

## Purpose

This is the final refactor plan for bringing `@lupinum/ginko-content` close to 10/10 across architecture, public API design, readability, junior-developer understandability, typing, error handling, testability, documentation, dependency/configuration design, consistency, and long-term maintainability.

It combines the maintainability review in `findings.md`, the first refactor plan in `refactor.md`, and an independent external refactor proposal. The external proposal was especially strong on public API drift, documentation contradictions, ADR alignment, and i18n typing. The first plan was stronger on concrete file-level decomposition, generated assets, derived-state risks, and module/runtime boundary cleanup.

The final direction is:

1. Stop public API and docs drift first.
2. Lock the public surface before moving internals.
3. Harden query and provider boundaries.
4. Type the localized/i18n result model.
5. Split large boundary files only after contracts are clearer.
6. Improve contributor onboarding and verification.

This is not a rewrite plan. The current library already has good foundations: architecture docs, contract tests, a provider contract, collection handles, a real query pipeline, runtime config guards, docs, examples, and verification commands. The work here is to remove drift, tighten boundaries, and make the intended architecture enforceable.

## Non-Negotiable Refactor Principles

- Delete before adding.
- Prefer hard cutovers for unreleased/internal paths.
- Do not add compatibility shims for internal paths.
- Do not keep old and new public stories side by side.
- Do not create generic services/adapters unless they remove real duplication or enforce a real contract.
- Provider capabilities remain the source of truth.
- Derived data must be marked as derived, rebuildable from canonical state, and invariant-tested.
- Keep backend/provider invariants out of frontend orchestration.
- Runtime should bind Nuxt/H3/Vue context and call domain logic; it should not invent domain behavior.
- Public exports are a contract, not a convenience barrel.

## Current Scorecard

| Dimension | Current | Target | Main Gap |
|---|---:|---:|---|
| Architecture | 7/10 | 9-10/10 | Good intended layering, but large boundary files and broad runtime/public surfaces blur ownership. |
| Public API design | 7/10 | 9-10/10 | Unified query API is strong, but README/examples/ADRs still teach competing paths. |
| Readability | 7/10 | 9-10/10 | Core is readable; runtime query, module setup, composables, doctor, and query types are too dense. |
| Junior-developer understandability | 6/10 | 9-10/10 | Docs exist, but conflicting API guidance and hidden i18n/query coupling make safe changes hard. |
| Typing/type safety | 7/10 | 9-10/10 | Strong public type ideas, but provider results, transport params, i18n metadata, and casts are weak spots. |
| Error handling | 6/10 | 9-10/10 | Expected failures use mixed raw errors, provider errors, H3 errors, and silent normalization. |
| Testability | 8/10 | 9-10/10 | Tests are a strength; missing drift, generated declaration, malformed provider, and handler-boundary tests. |
| Documentation | 8/10 | 9-10/10 | Lots of useful docs, but README/examples/ADRs/public-surface docs are not fully aligned. |
| Dependency/config design | 6/10 | 9-10/10 | Config/defaults/generated imports are useful but too spread out and manually mirrored. |
| Consistency | 7/10 | 9-10/10 | Old/new vocabulary, raw strings vs handles, `path` vs `_path`, and export styles are inconsistent. |
| Long-term maintainability | 7/10 | 9-10/10 | The i18n/query/provider/public API intersection will become painful unless simplified now. |

## What A 10/10 Looks Like Here

A near-10 Ginko Content library would look like this:

- A new user learns one recommended path for route pages, lists, navigation, server reads, sitemap, search, and provider implementation.
- README, examples, ADRs, package exports, generated `#content/*` imports, public-surface docs, and tests agree.
- `@lupinum/ginko-content/client` and `/server` are curated stable facades, not broad internal barrels.
- Advanced surfaces such as CMS, cache, testing, and agent helpers are documented as advanced subpaths or made internal.
- Query validation happens once and is reused at every external boundary.
- Provider authors return predictable shapes; malformed provider output fails loudly with stable errors.
- Localized document metadata has one canonical runtime and TypeScript shape.
- Large boundary files are split by responsibility after the behavior contract is locked.
- Generated declarations and derived route/search/sitemap data are tested against canonical behavior.
- A junior contributor can find "change X here, run Y tests, do not touch Z" guidance.

## Final Execution Plan

### Phase 1: Stop Public API And Docs Drift

This is the highest-priority phase. Do it before major internals move. The library cannot be close to 10/10 while active docs teach different public APIs.

#### Current Evidence

- `packages/content/README.md` still teaches `useContentPage('pages')`.
- `examples/essentials/hello-world/pages/[...slug].vue` and `examples/navigation/use-route/pages/[...slug].vue` use `useContentPage('pages')`.
- `meta/VISION.md`, `meta/ABSTRACTIONS.md`, and skill references prefer `useContentOne(handle, { by: { route } })`.
- `meta/adr/0005-collection-first-public-query-surface.md` still describes old `queryCollection` / `serverQueryCollection` era behavior.
- Runtime comments and internal names still mention older helpers.
- Some examples still use `Content V2` wording and raw `_path` patterns.

#### Target State

There is one official beginner route-page story:

```ts
import { pages } from '~/content.config'

const { page } = await useContentPage(pages)
```

`useContentPage(handle)` is the ergonomic route-page wrapper. It resolves the current route through `useContentOne(handle, { by: { route } })` and may add route-page conveniences such as not-found handling and surround/previous/next data.

`useContentOne(handle, { by })` remains the lower-level primitive for explicit route, path, and ref reads.

Collection handles are the preferred public path. Raw string collection names are documented only as a dynamic escape hatch with weaker inference.

`useContentPage` must be classified as one of:

- **Stable wrapper:** kept, accepts collection handles, documented as a wrapper over `useContentOne(handle, { by: { route } })`.
- **Migration helper:** documented only in migration/doctor contexts, not README quickstart.
- **Removed before 1.0:** deleted from active docs and exports if not worth carrying.

Recommendation: keep `useContentPage` only if it becomes a thin, handle-compatible stable wrapper. Otherwise remove it before 1.0.

#### Work

Update:

- `packages/content/README.md`
- `examples/essentials/hello-world/pages/[...slug].vue`
- `examples/navigation/use-route/pages/[...slug].vue`
- `examples/navigation/fetch-content-navigation/**`
- `examples/queries/**`
- `playground/ginko-basic/pages/**`
- `playground/ginko-i18n/pages/**`
- `meta/skill/references/public-surface.md`
- `meta/skill/references/module-config.md`
- `meta/skill/references/routing-rendering-i18n.md`
- `meta/skill/references/testing-examples-docs.md`
- `meta/adr/0005-collection-first-public-query-surface.md`
- `meta/adr/0016-unified-query-api.md`
- `meta/adr/README.md`

Normalize:

- Route pages use `useContentPage(handle)` for the common wrapper path.
- Explicit one-document reads use `useContentOne(handle, { by })`.
- Lists use `many(handle, ...)` or `useContentMany(handle, ...)`.
- Navigation uses the chosen documented navigation API consistently.
- Public examples use collection handles.
- App links use route-safe `path`, not raw `_path`, unless explicitly explaining internals.
- Vue examples use `script setup lang="ts"`.
- Props are typed.
- `v-for` keys are stable.
- Old `Content V2` wording is removed.

#### Tests

Expand `test/unit/docs-drift.test.ts` so active docs/examples fail on removed or demoted APIs outside migration/doctor docs:

- `queryCollection(`
- `serverQueryCollection(`
- `queryCollectionNavigation`
- `queryCollectionPage`
- `resolveContentReference(`
- `useContentList(`
- `useContentRoute(`
- `useContentPage('pages')` if `useContentPage` is not the official quickstart wrapper
- raw `_path` in app-link examples, unless explicitly allowed

Also add a separate docs-drift guard for compatibility-only APIs:

- `useContentSwitchLocalePath(` should not appear in beginner docs as the preferred locale-switch API, but it may appear in advanced, compatibility, or migration docs until a replacement exists.

Add a README fixture test that compiles or typechecks the primary examples.

#### Acceptance Criteria

- README, examples, ADR index, skill refs, public-surface docs, and runtime import docs teach one current API model.
- ADR-0005 is marked superseded by ADR-0016 or clearly historical.
- No active docs teach removed query APIs except migration/doctor docs.
- Public examples prefer collection handles.
- `pnpm verify` passes.

## Phase 2: Lock The Public Surface

Do this before deep file movement. A refactor is only safe when the team knows what public behavior must stay stable.

### Current Evidence

`packages/content/src/public/server.ts` exports a broad mix:

- unified query API.
- route helpers.
- agent path helpers.
- agent markdown serializers/renderers.
- agent site generation helpers.
- sitemap helper.
- provider types.
- cache helpers.
- cache hints.
- provider errors.

This makes advanced runtime helpers look as stable and beginner-facing as `one`, `many`, and `tree`.

`packages/content/src/module/runtime-assets.ts` manually mirrors generated `#content/server` declaration paths. That makes generated imports another public-ish surface that can drift.

### Target State

Public surfaces are explicit:

- `@lupinum/ginko-content/client`: user-facing client helpers/composables.
- `@lupinum/ginko-content/server`: stable server query and provider-facing primitives.
- `@lupinum/ginko-content/agent`: only if agent helpers are intended as public API.
- `@lupinum/ginko-content/cache`: only if cache helpers are intended as public API.
- `@lupinum/ginko-content/cms-contract`: advanced pure CMS contract.
- `@lupinum/ginko-content/cms-import`: advanced CMS import helpers.
- `@lupinum/ginko-content/testing/*`: documented test-only public subpaths.

Do not create new subpaths just to make the export map look tidy. Segment only where the audience and stability policy are different.

### Work

Audit and classify every export in:

- `packages/content/src/public/client.ts`
- `packages/content/src/public/server.ts`
- `packages/content/src/public/provider.ts`
- `packages/content/src/public/provider-errors.ts`
- `packages/content/package.json`
- `packages/content/src/module/runtime-assets.ts`

For each export, classify:

- Stable beginner API.
- Stable advanced API.
- Provider-author API.
- Testing-only API.
- Internal accidental export.
- Migration-only API.

Specific decisions:

- Decide whether `agentMarkdownPathForRoute`, serializers, `resolveContentMarkdown`, `renderLlmsTxt`, and related agent helpers belong in `/server` or an explicit `/agent` subpath.
- Decide whether cache helpers belong in `/server` or `/cache`.
- Decide whether `ContentQueryBuilderParams` should remain public or become internal transport.
- Decide whether `getCollectionPath` is stable public API or an internal route helper.
- Ensure generated `#content/server` declarations match the documented server surface.

### Tests

Extend:

- `test/contracts/package-exports-contracts.test.ts`
- `test/contracts/runtime-assets-contracts.test.ts`

Assert:

- package exports match the documented surface.
- `public/client.ts` exports match the documented client surface.
- `public/server.ts` exports match the documented server surface.
- generated app auto-imports match docs.
- generated server declarations match docs.
- removed APIs are not exported from stable subpaths.
- advanced subpaths are present only when documented.

### Acceptance Criteria

- Every public export has an audience and docs.
- Beginner docs do not expose CMS/cache/agent/testing concepts as the main API.
- Generated `#content/*` declarations are tested as public contract.
- Package export tests prevent accidental API growth.

## Phase 3: Harden Query And Provider Boundaries

This phase improves safety and debuggability. It should happen before splitting query files too much, because the split should follow the new boundary contract.

### Current Evidence

`ContentProvider.query` currently accepts a very broad return type:

```ts
Promise<MaybeContentProviderResult<ContentQueryResponse<T> | T[] | T | number | undefined>>
```

`runtime/server/provider-query.ts` normalizes arrays, single items, numbers, envelopes, and `undefined`. This is convenient, but it makes malformed provider behavior easy to hide.

`runtime/server/api/query.ts` passes `getContentQuery(event)` directly to provider dispatch. Public query params can enter through composables, helpers, HTTP endpoints, and provider code. If validation is not centralized, behavior will drift.

### Target State

There is one query validation and normalization boundary for public inputs.

Provider query output is exact enough that provider authors cannot accidentally return a list for count, a number for many, or an incomplete envelope without an actionable error.

### Work

Create or consolidate:

- `validateAndNormalizePublicQuery`
- `normalizeProviderQueryResponse`
- `assertProviderQueryResultShape`

Keep the implementation boring and direct. Do not introduce a large validation framework.

Apply validation at:

- `packages/content/src/runtime/server/api/query.ts`
- `packages/content/src/runtime/server/query-executor.ts`
- `packages/content/src/runtime/server/query-api.ts`
- `packages/content/src/runtime/server/provider-query.ts`
- any client/server transport path that accepts serialized query params.

Recommended provider result target:

```ts
type ProviderQueryResult<T> =
  | { kind: 'many'; result: T[]; total: number; skip: number; limit: number }
  | { kind: 'one'; result: T | null }
  | { kind: 'count'; result: number }
```

If released public compatibility requires a transition, keep compatibility only at one boundary, mark it deprecated, test it, and set a removal target. For unreleased internals, hard cut.

### Error Policy

Expected failures should have stable codes:

- invalid collection handle.
- unsupported operator.
- malformed query params.
- malformed provider module.
- malformed provider result.
- invalid populate target.
- disabled capability.
- invalid parser input.
- missing required production config such as site URL.

Use existing `ContentError`, `ContentProviderError`, and H3 mapping where appropriate. Add only small helpers if needed:

- `createContentUsageError`
- `createProviderShapeError`
- `createParserError`

Do not build a large error framework.

### Tests

Add malformed provider tests:

- count query returns array.
- many query returns number.
- one query returns array without explicit envelope.
- envelope misses `total`.
- envelope has wrong `result` shape.
- unsupported query operator reports a stable code.
- malformed public query params fail before provider dispatch.

Add handler-level tests for:

- missing collection.
- invalid pagination bounds.
- unsupported regex/operator input.
- malformed `where`.
- unsupported provider capability.

### Acceptance Criteria

- Public query validation happens before provider dispatch.
- Provider result mistakes fail loudly with stable error codes.
- Provider conformance tests document the exact return contract.
- `ContentProvider.query` is no longer a broad union in the long-term target.
- No silent fallback to count `0` or empty arrays for malformed provider output.

## Phase 4: Type The Localized/I18n Result Model

This is the highest-complexity domain area. It touches route resolution, fallback, translated slugs, variants, navigation, search, sitemap, and locale switching.

### Current Evidence

The code uses several related shapes:

- `path`
- `_path`
- `canonicalPath`
- `_variantPaths`
- `localePaths`
- `locale`
- `_locale`
- fallback metadata
- requested route/path/ref metadata

Some runtime query code reads these through casts. That hides the real contract and makes localized behavior hard to change safely.

### Target State

Localized page/query results have one canonical internal type.

Example target shape:

```ts
export interface LocalePathEntry {
  path: string
  translated: boolean
  fallback?: string
}

export interface ContentResolutionMeta {
  locale: string
  requestedLocale?: string
  fallback: boolean
  fallbackLocale?: string
  path: string
  requestedPath?: string
  requestedRoute?: string
  requestedRef?: string
  availableLocales: string[]
}

export type LocalizedContentDocument<T extends ParsedContent = ParsedContent> = T & {
  path: string
  canonicalPath: string
  locale: string
  defaultLocale: string
  localePaths: Record<string, LocalePathEntry>
  resolved: ContentResolutionMeta
  stem: string
  extension?: string
}
```

Keep `_path` where it is a canonical stored content field. Do not pretend it does not exist. The goal is to stop leaking raw `_path` into app-facing route examples and to make route-safe `path` explicit.

### Work

Introduce or consolidate types for:

- localized document result.
- locale path entry.
- resolution metadata.
- variant seed.
- content route metadata.
- selected localized result preserving required metadata.

Refactor:

- `packages/content/src/features/localization/results.ts`
- `packages/content/src/runtime/query/unified.ts`
- `packages/content/src/runtime/app/composables/locale-context.ts`
- `packages/content/src/runtime/app/composables/locale.ts`
- `packages/content/src/runtime/app/composables/route.ts`
- `packages/content/src/runtime/server/provider-query.ts`
- sitemap/search/navigation paths that depend on localized route metadata.

Specific target:

- `variants()` should not rely on `as unknown as ...` to read `_variantPaths`, `localePaths`, `path`, or `locale`.
- variant resolution should be split by selector type: ref, route, path.
- `localePaths` should have one shape everywhere.
- selecting fields should not accidentally strip route metadata needed by page rendering, locale switching, sitemap, or navigation.

### Tests

Add or extend tests for:

- `localePaths` shape.
- translated slugs.
- strict locale without fallback.
- fallback locale with route-safe `path`.
- variants by ref.
- variants by route.
- variants by path.
- selected fields preserving required metadata.
- sitemap alternates from localized route metadata.
- navigation paths under localized route mounts.
- search result paths.

Add type fixtures proving:

- i18n handles require locale where appropriate.
- dynamic string collections return weaker types than handles.
- `localePaths` and variant results are typed.
- `select` keeps required result metadata for route-page helpers.

### Acceptance Criteria

- Localized result shape has one canonical type.
- `variants()` and locale switching are cast-light and branch-testable.
- Fallback behavior is tested across route, navigation, search, and sitemap.
- Contributors can understand i18n result behavior from types and tests, not only comments.

## Phase 5: Split Large Boundary Files

Do this after Phases 1-4 clarify behavior. Splitting too early risks moving unclear contracts into more files.

### Current Evidence

Large files:

- `packages/content/src/module.ts`: 720 lines.
- `packages/content/src/runtime/query/unified.ts`: 974 lines.
- `packages/content/src/runtime/app/composables/use-content.ts`: 810 lines.
- `packages/content/src/cli/doctor.ts`: 1019 lines.
- `packages/content/src/types/query.ts`: 1050 lines.
- `packages/content/src/module/integration-hooks.ts`: 280 lines with duplicated ingest-like behavior.

### Target State

Large files become focused coordinators or domain modules. No split should introduce generic buckets like `helpers.ts` unless the existing code already has a clear shared concept.

### Module Setup

Split `packages/content/src/module.ts` into:

- `module/defaults.ts`
- `module/provider-registration.ts`
- `module/search-prerender.ts`
- `module/agent-prerender.ts`
- `module/sitemap-registration.ts`
- `module/nitro-registration.ts`
- `module/dev-runtime.ts` if needed.

Acceptance criteria:

- `module.ts` is under 250 lines.
- `module.ts` coordinates setup only.
- no direct `mkdirSync`, `writeFileSync`, Markdown link regex parsing, Pagefind writing, or agent route expansion in `module.ts`.
- search/agent/sitemap registration helpers have focused tests.

### Runtime Query

Split `packages/content/src/runtime/query/unified.ts` into:

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
- `runtime/query/unified.ts` as a small barrel/compat internal entry.

Acceptance criteria:

- each operation file has one primary operation.
- shared helpers have domain names.
- public behavior does not change.
- operation tests cover behavior through public APIs, not implementation trivia.

### Composables

Split `packages/content/src/runtime/app/composables/use-content.ts` into operation-specific files:

- `use-content-one.ts`
- `use-content-many.ts`
- `use-content-page.ts` only if kept.
- `use-content-tree.ts`
- `use-content-neighbors.ts`
- `use-content-variants.ts`
- `use-content-backlinks.ts`
- a small shared async-data helper.

Acceptance criteria:

- no over-generic composable machinery.
- shared helper remains small and obvious.
- type inference remains equivalent.

### Doctor

Split `packages/content/src/cli/doctor.ts` by rule group:

- `cli/doctor/index.ts`
- `cli/doctor/files.ts`
- `cli/doctor/report.ts`
- `cli/doctor/rules/dependencies.ts`
- `cli/doctor/rules/public-api.ts`
- `cli/doctor/rules/rendering.ts`
- `cli/doctor/rules/i18n.ts`
- `cli/doctor/rules/sitemap.ts`

Acceptance criteria:

- each rule has a name, severity, matcher, and fixture tests.
- existing doctor behavior does not change.

### Query Types

Split `packages/content/src/types/query.ts` into:

- `types/query/public.ts`
- `types/query/transport.ts`
- `types/query/results.ts`
- `types/query/populate.ts`
- `types/query/navigation.ts`
- `types/query/sitemap.ts`
- `types/query/index.ts`

Acceptance criteria:

- public imports stay stable through barrels.
- internal modules import transport types from the transport file.
- public options and internal execution params are not conflated.

### Integration Hooks And Derived State

Audit `packages/content/src/module/integration-hooks.ts`.

Target:

- `parseCollectionFiles` is either deleted in favor of canonical ingest/graph behavior, or moved to a clearly named build-time derived route discovery helper.
- The helper is explicitly marked as derived.
- Invariant tests prove derived prerender/sitemap routes match canonical behavior for localized content, translated slugs, draft/partial/navigation files, and data collections.

Acceptance criteria:

- there is one canonical source of content parsing truth.
- derived build-time route discovery has a rebuild story and invariant tests.

## Phase 6: Generated Assets, Config, And Dependency Boundaries

### Current Evidence

`module/runtime-assets.ts` manually generates import/type declarations that mirror runtime paths and package/dist paths. This is a useful feature, but it is also a public contract and a drift risk.

Feature-level code such as sitemap behavior depends on runtime/config assumptions. Defaults and config validation are spread across module/runtime paths.

### Target State

Generated assets are treated as public API. Config defaults are centralized and typed. Optional dependencies are lazy and documented.

### Work

Generated declarations:

- snapshot generated `#content/server` and app auto-import declarations.
- compile representative consumer fixtures against generated declarations.
- document which generated imports are stable.

Config/defaults:

- extract module defaults into `module/defaults.ts`.
- centralize runtime config normalization/validation.
- ensure site URL, sitemap, search, agent, cache, provider, and i18n defaults are documented and tested.

Dependencies:

- audit runtime vs dev dependencies.
- make optional feature dependencies lazy where practical.
- document peer requirements.
- keep framework coupling out of runtime-neutral layers: `core`, `features`, `cms-contract`, and `cms-import`.
- treat `storage` as the default filesystem/Nitro storage bridge: it may depend on `integrations/nitro` and H3-bound request context, but it must not import `runtime`, `module`, public facades, or CLI code.
- keep pure storage-adjacent logic, such as validation code, explicitly framework-free and covered by boundary tests.

### Tests

- generated declaration snapshot/contract tests.
- runtime config validation tests.
- architecture-boundary tests for forbidden imports.
- package export tests for advanced subpaths.

### Acceptance Criteria

- Generated declarations cannot drift silently.
- Defaults have one source of truth.
- Runtime config failures are actionable.
- Optional features do not pull unnecessary runtime dependencies into the core path.

## Phase 7: Contributor Ergonomics And Onboarding

This phase makes the codebase safer for junior and mid-level contributors.

### Work

Create or update contributor maps:

- `packages/content/docs/QUERY_PIPELINE.md`
- `packages/content/docs/PROVIDER_CONTRACT.md`
- `packages/content/docs/MODULE_SETUP.md`
- `packages/content/docs/RENDERING.md`
- `packages/content/docs/CMS_CONTRACT.md`
- `packages/content/docs/CHANGE_GUIDE.md`

Each guide should answer:

- where to make the change.
- what invariant must be preserved.
- what public API impact to consider.
- what provider impact to consider.
- what tests to run.
- what not to touch.

Add change recipes for:

- adding a query operator.
- adding a provider capability.
- adding a parser.
- changing route-page loading.
- changing i18n fallback behavior.
- changing navigation tree behavior.
- changing search behavior.
- changing sitemap behavior.
- changing public exports.
- changing generated imports.

Add a small PR checklist:

- I did not add public exports accidentally.
- I updated docs/examples for public behavior.
- I used collection handles in public examples.
- I added or updated contract tests.
- I did not put domain logic in runtime.
- I did not add `any` or `as unknown as` in query/i18n/provider paths without isolating it.
- I did not create a second source of truth.

### Acceptance Criteria

- A junior contributor can find the right files for common changes.
- Focused test commands are documented per subsystem.
- High-risk files explain ownership and invariants.
- Reviewers no longer need to repeatedly explain the same architecture boundaries.

## Highest-Impact Refactors Ranked

### 1. Public API Convergence

Fix README, examples, ADRs, public-surface docs, runtime import docs, and docs-drift tests so the project teaches one current API.

Why this is first:

- It affects every user and contributor.
- It reduces junior confusion immediately.
- It prevents old API vocabulary from becoming permanent.
- It does not require risky internals movement.

### 2. Public Surface Lock

Snapshot exports and generated imports. Classify stable, advanced, testing, migration, and internal surfaces.

Why this is second:

- It prevents accidental API growth.
- It clarifies what future refactors must preserve.
- It forces decisions around agent/cache/CMS/testing exports.

### 3. Query And Provider Boundary Hardening

Centralize query validation and make provider return shapes exact.

Why this is third:

- It improves safety at the most important extension boundary.
- It makes provider bugs easier to debug.
- It creates a stable target before splitting query internals.

### 4. Typed Localized Result Model

Create one canonical localized document shape and refactor casts around variants/locale paths/fallback.

Why this is fourth:

- This is the most complex product behavior.
- It affects route pages, locale switching, variants, navigation, search, and sitemap.
- Types and tests will prevent subtle regressions.

### 5. Boundary File Decomposition

Split `module.ts`, `runtime/query/unified.ts`, `use-content.ts`, `cli/doctor.ts`, and `types/query.ts`.

Why this is fifth:

- Splitting is valuable, but only after contracts are clear.
- Otherwise the project gets more files with the same ambiguity.

### 6. Generated Assets And Config

Test generated declarations, centralize defaults, validate config, and audit dependencies.

Why this is sixth:

- Generated imports are public-ish API.
- Config drift causes confusing runtime failures.
- Optional feature boundaries matter as the package grows.

### 7. Contributor Guides

Add change guides, subsystem maps, and PR checklist.

Why this is seventh:

- Documentation should reflect the cleaned-up reality.
- It turns the refactor into durable team practice.

## Consumer Validation: `shadcn-starter-i18n`

This plan was checked against `/Users/matthias/Git/workspace/shadcn-starter-i18n`, a real consumer of `@lupinum/ginko-content` through `@lupinum/ginko-content@0.1.4`.

The consumer confirms that several APIs in question are not theoretical. They are actively used in a realistic Nuxt 4, i18n, docs/blog/services/legal site:

- route pages use `useContentPage("docs")` in `app/features/docs/components/DocsPageContent.vue` and `useContentPage("blog")` in `app/features/blog/pages/BlogDetailPage.vue`.
- detail pages use `useContentOne("services")`, `useContentOne("references")`, and `useContentOne("legal")` in the service, reference, and legal feature pages.
- index pages use `useContentMany("services")`, `useContentMany("references")`, `useContentMany("blog")`, `useContentMany("authors")`, `useContentMany("testimonials")`, and `useContentMany("faqs")` across home, about, blog, services, and references pages.
- docs navigation uses `useContentNavigation("docs")` in `app/features/docs/composables/useDocsNavigation.ts`.
- locale switching uses `useContentOne`, `useContentVariants`, and `useContentSwitchLocalePath` in `app/composables/useLocalizedRouteSwitch.ts`.
- command palette search uses `useContentSearch` from `@lupinum/ginko-content/client` in `app/composables/useCommandCenter.ts`.
- "copy markdown" UI uses `agentRawPathForRoute` from `@lupinum/ginko-content/client` in `app/features/content/components/PageMarkdownCopy.vue`.
- server-side custom markdown serialization uses agent markdown APIs from `@lupinum/ginko-content/server` in `server/utils/agent-serializers.ts` and `packages/content-components/src/runtime/server/agent-markdown.ts`.
- `content.config.ts` uses `defineCollection`, `defineContentConfig`, `reference`, `defineAgentMetadataFields`, `defineAgentSection`, and `defineAgentAppPage`.

This consumer also confirms the main maintainability problems:

- the app defines typed collection handles in `content.config.ts`, but app code mostly passes raw string collection names.
- docs inside the consumer teach `useContentPage(docs)`, while app source often uses `useContentPage("docs")`.
- docs/blog pages depend on the ergonomic `{ page, previous, next }` shape from `useContentPage`.
- locale switching has app-specific logic to normalize `localePaths` entries and combine `useContentOne`, `useContentVariants`, `useContentSwitchLocalePath`, and Nuxt i18n fallback.
- agent APIs are valuable, but exposing all serializer/rendering helpers from `/server` makes the stable server surface too broad.

### Consumer-Backed Keep, Remove, Refine Matrix

| Surface | Decision | Evidence | Refactor Action |
|---|---|---|---|
| `useContentPage` | Keep and refine. | Used for docs and blog detail pages; return shape includes route page plus previous/next data. | Make it the official handle-first route-page wrapper. |
| `useContentOne` | Keep and refine. | Used for explicit route/path reads and locale-switch lookup. | Keep as lower-level primitive; type `by` selectors as mutually exclusive. |
| `useContentMany` | Keep and refine. | Used broadly for home, about, blog, services, references, testimonials, and FAQ lists. | Keep as app-facing list composable; prefer handles in docs. |
| `useContentNavigation` | Keep and refine. | Used for docs sidebar navigation. | Keep as app-facing wrapper over lower-level `tree`; avoid recommending both names equally. |
| `useContentTree` | Refine audience. | Not used by this consumer; may still matter as low-level/server vocabulary. | Keep only if it has a distinct lower-level audience; otherwise demote from beginner docs. |
| `useContentSearch` | Keep and refine. | Used directly for command-center search. | Keep stable; validate search config and result item typing. |
| `useContentVariants` | Keep and refine. | Used for service/reference/legal locale switching. | Keep as localized variants primitive; align with canonical `localePaths` type. |
| `useContentSwitchLocalePath` | Keep for compatibility, refine or replace later. | Used in active locale-switch fallback logic. | Do not remove now. Mark as compatibility API until a higher-level locale switch API is proven. |
| `useContentLocaleSwitch` | Do not add yet. | It could remove real consumer glue, but current localized metadata is not canonical enough. | Add only after typed `LocalizedContentDocument` / `localePaths` exists and tests prove it replaces consumer glue. |
| `ContentRenderer` | Keep and refine. | Used for docs, blog, services, references, and legal pages. | Keep central; document full-document input clearly. |
| Agent config APIs | Keep and refine. | Used heavily in `content.config.ts` for agent-readable app pages and metadata. | Keep under `/config`; document as advanced agent configuration. |
| Agent markdown server APIs | Keep, but segment. | Used by the app and content-components package for custom serializers. | Move to an agent-focused subpath before 1.0 if feasible, or deprecate `/server` re-exports with a clear window. |
| `agentRawPathForRoute` | Keep, but segment. | Used by copy-markdown UI. | Move to an agent-focused client surface, or clearly classify it as advanced in `/client`. |
| Raw string collection names | Keep as weak dynamic input. | Current consumer app code and tests use strings extensively. | Do not break strings; make handles the documented/default typed path. |
| Old fluent query APIs | Remove/internalize. | Consumer does not use `queryCollection`, `serverQueryCollection`, `queryCollectionNavigation`, or `queryCollectionPage`. | Keep only in migration docs/doctor messaging; do not export from stable beginner surfaces. |

### Consumer-Informed API Decisions

#### Keep And Refine `useContentPage`

Do not remove `useContentPage` outright.

The starter uses it for docs and blog detail pages because it is ergonomic: it resolves the current route, fallback behavior, not-found handling, surround/previous/next, and full-page rendering data in one call.

Refine it instead:

- make it a documented stable wrapper over `useContentOne(handle, { by: { route } })`.
- make collection handles the primary overload.
- keep raw string collection names as a weaker dynamic overload.
- document the exact equivalence to the lower-level API.
- ensure the return shape is clearly typed: `page`, `previous`, `next`, and any surround metadata.
- keep examples that use `useContentPage`, but use handles, not raw strings.

Target docs:

```ts
import { docs } from '~/content.config'

const { page, previous, next } = await useContentPage(docs, {
  fallback: true,
  surround: true
})
```

This gives beginners a good route-page API without competing with the unified API. It is a convenience wrapper, not a second query model.

#### Keep `useContentMany`

Keep `useContentMany`.

The starter uses it broadly for homepage sections, blog lists, services, references, authors, testimonials, and FAQs. It maps directly to a common app job: load a reactive list from a collection.

Refine it:

- docs should use collection handles.
- raw strings remain supported as dynamic escape hatch.
- examples should show `where`, `sort`, `limit`, `locale`, `fallback`, and `populate`.
- type tests should prove handle-based calls infer collection fields better than string-based calls.

#### Keep `useContentOne`

Keep `useContentOne` as the lower-level route/path/ref primitive.

The starter uses it for services, references, legal pages, and locale switching. It is the right API when the caller needs explicit `by: { route }` or `by: { path }` control.

Refine it:

- keep it as the canonical primitive under `useContentPage`.
- make the route/path/ref selector docs clearer.
- ensure `notFound` handling is either available consistently or documented as wrapper-only.
- type `by` selectors as mutually exclusive.

#### Keep `useContentNavigation`, But Align Naming With `tree`

Do not remove `useContentNavigation` without a replacement migration.

The starter uses `useContentNavigation("docs")` for sidebar navigation. The public low-level verb may be `tree`, but app developers naturally look for "navigation".

Recommended decision:

- keep `useContentNavigation` as a stable app-facing wrapper.
- document it as the navigation/tree wrapper.
- ensure it accepts handles.
- decide whether `useContentTree` is also needed. Avoid two equally recommended names.

Preferred outcome:

- app-facing composable: `useContentNavigation`.
- lower-level pure/server verb: `tree`.
- docs explicitly map one to the other.

#### Keep `useContentSearch`

Keep `useContentSearch`.

The starter uses it for a command center. Search is a user-facing workflow with stateful query/results behavior, so a composable is justified.

Refine it:

- document whether it is client-only, server-safe, or hybrid.
- type result items consistently.
- ensure search config and collection inclusion are validated.

#### Refine Locale Switching APIs

Do not keep the current locale-switching surface unchanged.

The starter has to combine:

- `useContentOne`
- `useContentVariants`
- `useContentSwitchLocalePath`
- Nuxt i18n `useSwitchLocalePath`
- custom route classification.
- custom `localePaths` normalization.

That is a sign the API is useful but incomplete.

Decision:

- keep `useContentVariants`.
- keep `useContentSwitchLocalePath` for compatibility because the real consumer uses it today.
- classify `useContentSwitchLocalePath` as either stable compatibility API or deprecated API with a replacement, but do not silently remove it.
- introduce or stabilize one higher-level route-switch helper only if it directly removes the consumer's custom glue.

Candidate target:

```ts
const { switchPath, activeContentPage } = await useContentLocaleSwitch({
  collections: [docs, blog, services, references, legal],
  locale: () => locale.value,
  route: () => route.path,
  fallback: true
})
```

Only add this if it can be implemented directly on top of canonical localized metadata. Do not add it before `LocalizedContentDocument` / `localePaths` are typed.

Short-term:

- standardize `localePaths` shape.
- document how `useContentVariants` and `localePaths` interact.
- mark `useContentSwitchLocalePath` as compatibility API until a replacement exists.
- add a contract test that proves any future replacement can cover docs, blog, services, references, legal, and root-mounted legal paths from the consumer pattern.

#### Keep Agent Config APIs

Keep the config-side agent APIs:

- `defineAgentMetadataFields`
- `defineAgentSection`
- `defineAgentAppPage`
- `agentMetadataFields`

The starter uses them in `content.config.ts` and `app/config/site.schema.ts` for real agent-ready output. These are not accidental.

Refine them:

- keep them under `@lupinum/ginko-content/config`.
- document them as advanced agent configuration.
- ensure they do not pull server/runtime dependencies into config.
- add type tests for agent metadata fields and app page definitions.

#### Move Or Segment Agent Markdown Server APIs

Do not remove agent markdown serializer APIs.

The starter and `@lupinum/content-components` use:

- `defineAgentMarkdownComponent`
- `registerAgentMarkdownComponents`
- `registerAgentMarkdownSerializers`
- `blockquoteMarkdown`
- `getMarkdownProp`
- agent serializer types.

These are real extension points for custom MDC/prose components.

But they should not remain mixed into the beginner `/server` surface forever.

Decision:

- keep the APIs.
- move or re-export them through `@lupinum/ginko-content/agent` or `@lupinum/ginko-content/server/agent`.
- keep `/server` focused on stable server content reads and provider/cache primitives.
- document agent markdown as an advanced surface.

Migration policy:

- if `/server` is already released with these exports, use a clear deprecation window.
- if still pre-1.0 enough for hard cutover, move them before 1.0 and update consumers.

#### Keep `agentRawPathForRoute`, But Move It To An Agent-Focused Client Surface

The starter uses `agentRawPathForRoute(route.path)` for a "Copy Markdown" button. That is a valid app feature.

Decision:

- keep the helper.
- prefer `@lupinum/ginko-content/agent/client` or `@lupinum/ginko-content/client/agent` over placing it in the main client beginner surface.
- document it as part of the agent markdown feature.

#### Keep `ContentRenderer`

Keep `ContentRenderer` as a central rendering API.

The starter consistently renders full documents through `<ContentRenderer :value="page" />`. Its docs correctly warn not to pass only `page.body`.

Refine it:

- make the "pass full document" rule prominent in Ginko docs.
- type renderer input as the full content document shape.
- avoid examples that render `body` directly unless they explain the tradeoff.

#### Remove Or Internalize Old Fluent Query APIs

The starter does not use:

- `queryCollection`
- `serverQueryCollection`
- `resolveContentReference`
- `queryCollectionNavigation`
- `queryCollectionPage`

These should not be part of active public docs. If internals still need similar behavior, rename it to internal/provider-specific names so code search does not suggest an obsolete API model.

#### Refine Raw String Collection Support

Do not remove raw string collection support immediately.

The starter uses strings everywhere in app source and tests. Removing string support would cause unnecessary churn and make dynamic generated pages harder.

Decision:

- keep raw strings as supported dynamic input.
- make handles the recommended docs path.
- add overloads so raw strings return weaker types.
- update docs and examples to import handles from `~/content.config`.
- add doctor guidance to suggest handles in app source when a matching exported handle exists.

This preserves compatibility while improving type safety.

### Updated Open-Question Answers

| Question | Decision | Reason |
|---|---|---|
| Keep `useContentPage`? | Keep and refine. | Real consumer uses its ergonomic `{ page, previous, next }` route-page shape. |
| Make `useContentOne` the only route-page API? | No. | It should be the primitive; `useContentPage` should be the route-page wrapper. |
| Keep raw string collection names? | Keep as dynamic escape hatch. | Existing consumer relies on strings, but handles should become the documented default. |
| Keep `useContentNavigation`? | Keep as app-facing wrapper. | Real docs sidebar uses it; map it clearly to lower-level `tree`. |
| Keep `useContentTree` too? | Only if it has a distinct audience. | Avoid two equally recommended navigation names. |
| Keep `useContentSearch`? | Keep. | Real command-center workflow uses it. |
| Keep `useContentSwitchLocalePath`? | Keep as compatibility API for now; refine or replace later. | Real consumer uses it today. Removing it before a replacement would break locale switching. |
| Add `useContentLocaleSwitch`? | Maybe, after localized metadata is typed. | It could remove real app glue, but adding it before canonical `localePaths` would create another source of truth. |
| Keep agent config APIs? | Keep. | Real `content.config.ts` uses them for agent output. |
| Keep agent markdown serializer APIs? | Keep, but segment. | Real extension point, but too broad for main `/server`. |
| Keep `agentRawPathForRoute`? | Keep, but agent-focused surface. | Real copy-markdown UI uses it. |
| Keep old fluent query APIs? | Remove from active public surface. | Consumer does not need them; they preserve stale vocabulary. |
| Keep `ContentRenderer`? | Keep and emphasize full-document input. | Central rendering path in consumer. |

### Impact On Phase 1

Phase 1 should not simply replace every `useContentPage` example with `useContentOne`.

Instead:

- beginner route-page examples may use `useContentPage(handle)` if it is kept as the official wrapper.
- lower-level route/path/ref examples should use `useContentOne(handle, { by })`.
- docs must explain the relationship.
- active examples should stop using `useContentPage("docs")` and prefer `useContentPage(docs)`.

The corrected public story is:

- **Page route:** `useContentPage(handle)` for common route pages.
- **Explicit one-document query:** `useContentOne(handle, { by })`.
- **List:** `useContentMany(handle, options)`.
- **Navigation:** `useContentNavigation(handle, options)` as app-facing wrapper over `tree`.
- **Variants/locale:** `useContentVariants` plus a refined locale-switch story.
- **Advanced agent:** agent APIs under an agent-focused public surface.

## Specific File-Level Recommendations

### Public API And Docs

- `packages/content/README.md`
- `packages/content/package.json`
- `packages/content/src/public/client.ts`
- `packages/content/src/public/server.ts`
- `packages/content/src/public/provider.ts`
- `packages/content/src/module/runtime-assets.ts`
- `meta/skill/references/public-surface.md`
- `meta/skill/references/module-config.md`
- `meta/skill/references/routing-rendering-i18n.md`
- `meta/skill/references/testing-examples-docs.md`
- `meta/adr/0005-collection-first-public-query-surface.md`
- `meta/adr/0016-unified-query-api.md`
- `meta/adr/README.md`

### Query And Provider Boundary

- `packages/content/src/types/query.ts`
- `packages/content/src/types/api.ts`
- `packages/content/src/public/provider.ts`
- `packages/content/src/runtime/server/api/query.ts`
- `packages/content/src/runtime/server/query-api.ts`
- `packages/content/src/runtime/server/query-executor.ts`
- `packages/content/src/runtime/server/provider-query.ts`
- `packages/content/src/runtime/server/provider-result.ts`
- `packages/content/src/runtime/server/providers/index.ts`
- `packages/content/src/runtime/server/providers/filesystem.ts`
- `packages/content/src/testing/provider-contract.ts`
- `packages/content/src/testing/provider-fixture.ts`

### I18n And Route Results

- `packages/content/src/features/localization/results.ts`
- `packages/content/src/features/localization/path.ts`
- `packages/content/src/runtime/query/unified.ts`
- `packages/content/src/runtime/app/composables/locale-context.ts`
- `packages/content/src/runtime/app/composables/locale.ts`
- `packages/content/src/runtime/app/composables/route.ts`
- `packages/content/src/features/navigation/**`
- `packages/content/src/features/search/**`
- `packages/content/src/features/sitemap/query.ts`

### Large Boundary Files

- `packages/content/src/module.ts`
- `packages/content/src/module/integration-hooks.ts`
- `packages/content/src/module/runtime-assets.ts`
- `packages/content/src/runtime/query/unified.ts`
- `packages/content/src/runtime/app/composables/use-content.ts`
- `packages/content/src/cli/doctor.ts`
- `packages/content/src/types/query.ts`

### Tests

- `test/unit/docs-drift.test.ts`
- `test/unit/architecture-boundaries.test.ts`
- `test/contracts/package-exports-contracts.test.ts`
- `test/contracts/runtime-assets-contracts.test.ts`
- `test/contracts/query-contracts.test.ts`
- `test/contracts/query-plan-contracts.test.ts`
- `test/contracts/app-query-contracts.test.ts`
- `test/contracts/use-content-page-contracts.test.ts`
- `test/contracts/content-route-contracts.test.ts`
- `test/contracts/provider-contracts.test.ts`
- `test/contracts/filesystem-provider-conformance.test.ts`
- `test/runtime/api-provider-boundary.test.ts`
- `test/fixtures/typecheck/types/ginko-api.ts`

## What Not To Do

Do not begin by splitting every large file. That improves appearance but not necessarily maintainability.

Do not add compatibility shims for internal runtime/source paths. For unreleased internals, hard cut.

Do not keep both `useContentPage('pages')` and `useContentOne(handle, { by: { route } })` as equally recommended page-loading models.

Do not add a generic provider adapter layer unless the provider contract cannot be expressed directly.

Do not create a large error framework. Add small typed helpers only where expected failures need stable codes.

Do not move domain logic into frontend composables to make app code convenient. Backend/provider invariants belong in core/features/provider layers.

Do not document advanced CMS/cache/agent/testing APIs in beginner docs as if they are the main product surface.

## Production-Quality Gate

Before this library should be considered production-quality or 1.0-ready:

- README, examples, ADRs, public docs, package exports, generated imports, and tests must agree.
- Active docs must not teach removed APIs except migration/doctor docs.
- The official route-page API must be decided and enforced.
- Public exports and generated imports must be snapshot-tested.
- Advanced surfaces must be segmented or explicitly documented.
- Public query validation must happen at every external boundary.
- Provider query return shapes must be exact or validated before use.
- Malformed provider behavior must fail loudly with stable errors.
- Localized document metadata must have one canonical type and runtime shape.
- `variants()`, locale switching, route resolution, sitemap, search, and navigation must share the same localized metadata assumptions.
- Derived route/search/sitemap generation must be marked, rebuildable, and invariant-tested.
- Large boundary files must be split by responsibility, not by arbitrary size alone.
- Contributor change guides must point to exact files and focused tests.
- `pnpm verify` and `pnpm run release:verify` must pass before handoff for release-sensitive changes.

## Final Recommendation

Proceed with the combined plan in order. Start with public truth and API convergence, then lock exports, then harden query/provider boundaries, then type i18n results, then split files.

This order matters. If the team starts with file splitting, it will spread unclear contracts across more modules. If the team starts with API/docs convergence, every later refactor has a stable target and a clear definition of done.

## Superseding Implementation Note

The root-cause completion pass resolved the open contradictions this plan left behind:

- `useContentLocaleSwitch` was removed from runtime code, public facades, generated app auto-imports, docs, metadata, and tests. The supported content locale-switch contract is `localePaths` on resolved localized documents. `useContentSwitchLocalePath` remains only as a compatibility fallback for route-only Nuxt I18n switching.
- `ContentProvider.query` was hard-cut to canonical `ContentQueryResponse<T>` envelopes. Raw arrays, raw documents, raw numbers, and `undefined` are invalid provider query results.
- `meta/public-surface.json` now classifies package exports, client/server facade exports, and generated app auto-imports with category, audience, and docs target.
- Static-output route discovery and raw markdown route expansion now live in pure helpers with focused unit tests.
