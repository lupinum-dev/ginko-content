# RFC Todo: Dream Experience Implementation

Status: release candidate complete
Date: 2026-06-02
Owner: unassigned
Source RFC: `dream-experience.md`

This checklist tracks the implementation plan for the Ginko Content dream
experience RFC. The intent is to ship in small, reviewable phases with explicit
verification and clean commits.

Principles for this work:

- prefer hard cutovers over compatibility paths for unreleased surfaces
- keep one source of truth per concept
- keep app-facing APIs explicit and Nuxt-like
- avoid adding abstractions until an acceptance criterion proves they are needed
- verify each phase in `ginko-content` and at least one real consumer before
  calling it done

## Phase 0: Baseline And Scope Lock

Goal: make the current behavior measurable before changing public APIs.

- [x] Confirm this todo matches the current RFC direction.
- [x] Move "derive collection names from config keys" out of the first cut if it
      is still listed as a first-cut task in `dream-experience.md`.
- [x] Confirm first-cut public APIs:
      `useContentPage('docs')`, `useContentMany('posts')`,
      `useContentNavigation('docs')`, `useContentHead(page)`.
- [x] Confirm low-level query functions stay explicit imports:
      `one`, `many`, `tree`, `neighbors`, `backlinks`.
- [x] Confirm fallback policy: active Nuxt locale may be inferred, fallback must
      stay explicit via `fallback: true` unless a collection opts in later.
- [x] Capture current consumer friction with short before examples from:
      `saas-i18n`, `saas-template`, `shadcn-starter`.
- [x] Identify the exact package and generated type files that own collection
      names, composables, search records, navigation records, and renderer
      fallback.

Acceptance criteria:

- [x] `dream-experience.md` and this file agree on first-cut scope.
- [x] No phase contains generated handles, route meta generation, markdown tag
      conventions, or shadcn section projection as first-cut work.
- [x] Each first-cut API has a named verification path.

Verification:

- [x] `pnpm lint`
- [x] `pnpm test`
- [x] `pnpm typecheck`

Commit checkpoint:

- [x] Commit RFC planning docs.

Suggested commit message:

```txt
docs: add dream experience implementation checklist
```

## Phase 1: Typed String Collection Names

Goal: app APIs accept typed collection name strings without losing collection
schema inference.

Scope:

- [x] Add generated collection name unions for app-facing APIs.
- [x] Add type helpers that map collection names to document, route, locale, and
      i18n metadata types.
- [x] Update existing query functions and composables, including
      `useContentPage` and `useContentMany`, to accept typed collection names.
- [x] Update planned navigation/search APIs to accept typed collection names
      once those APIs are introduced or revised in their own phases.
- [x] Keep existing handle-based internals only where they are already the
      canonical runtime path.
- [x] Do not add generated `#content/collections` handles in this phase.
- [x] Do not remove `defineCollection('name')` yet.

Acceptance criteria:

- [x] `useContentPage('docs')` infers the `docs` page type.
- [x] `useContentMany('posts')` infers the `posts` item type.
- [x] Invalid collection names fail typecheck.
- [x] Collection-specific options, including locale and populate targets, narrow
      from the selected string name.
- [x] Existing direct query APIs still work with explicit imports.

Tests:

- [x] Add type tests for valid and invalid collection names.
- [x] Add type tests for `useContentPage('docs')`.
- [x] Add type tests for `useContentMany('posts')`.
- [x] Add type tests for collection-specific locale options.

Verification:

- [x] `pnpm build:packages`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] Focused contract tests:
      `pnpm exec vitest run --config vitest.config.ts test/contracts/module-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts`

Consumer validation:

- [x] Convert one `saas-template` page to string collection API.
- [x] Convert one `saas-i18n` page to string collection API.
- [x] Convert one `shadcn-starter` page or query helper to string collection
      API.
- [x] Confirm no consumer imports `content.config.ts` only to pass a collection
      handle into an app-facing composable.

Commit checkpoint:

- [x] Commit typed collection string support.

Suggested commit message:

```txt
feat(content): type app APIs by collection name
```

## Phase 2: Nuxt Page API

Goal: make `useContentPage` the canonical route-page API for Nuxt apps.

Scope:

- [x] Support `useContentPage('docs')` with current route inference.
- [x] Return both `data` and `page`, where `page` is an alias for `data`.
- [x] Return `surround` from `useContentPage` when requested.
- [x] Keep `fallback: true` explicit.
- [x] Infer active Nuxt locale when the collection is localized and no explicit
      locale is provided.
- [x] Keep explicit `locale` override support.
- [x] Do not auto-generate `definePageMeta` or i18n routes in this phase.

Target API:

```ts
const { page, surround } = await useContentPage('docs', {
  fallback: true,
  surround: { fields: ['description'] }
})
```

Acceptance criteria:

- [x] Route-backed page lookup works without passing `path`.
- [x] Locale-aware page lookup uses active Nuxt locale by default.
- [x] Fallback content appears only when `fallback: true` is passed.
- [x] `surround` is available from the same composable call.
- [x] Consumers do not need a Nuxt UI surround adapter in page components.

Tests:

- [x] Add Nuxt runtime tests for route inference.
- [x] Add Nuxt runtime tests for explicit locale override.
- [x] Add Nuxt runtime tests for explicit fallback.
- [x] Add Nuxt runtime tests for `surround`.
- [x] Add type tests for the returned `page` alias.

Verification:

- [x] `pnpm build:packages`
- [x] `pnpm test -- --project nuxt`
- [x] `pnpm typecheck`
- [x] `pnpm docs:build`
- [x] Focused page contract tests:
      `pnpm exec vitest run --config vitest.config.ts test/contracts/use-content-page-contracts.test.ts`

Consumer validation:

- [x] Update docs page in `saas-template`.
- [x] Update localized docs page in `saas-i18n`.
- [x] Confirm fallback use in `saas-i18n` is visible in the call site.

Commit checkpoint:

- [x] Commit route-page composable changes.

Suggested commit message:

```txt
feat(content): make useContentPage route aware
```

## Phase 3: Navigation API

Goal: stop consumers from reimplementing content tree traversal.

Scope:

- [x] Add `useContentNavigation('docs')`.
- [x] Return normalized nodes with stable `id`, `path`, `title`, and children.
- [x] Support field selection for navigation metadata such as `icon`, `badge`,
      and `sidebar`.
- [x] Return `firstPage`.
- [x] Return a path lookup or `paths` helper for active-state consumers.
- [x] Keep section/group projection out of core for this phase.
- [x] Keep non-content app routes app-owned.

Target API:

```ts
const { data: navigation, firstPage, paths } = await useContentNavigation('docs', {
  fields: ['icon', 'badge', 'sidebar']
})
```

Acceptance criteria:

- [x] Docs sidebars can render without local recursive "find first page" code.
- [x] Current route active state can be computed without app-specific tree
      walking.
- [x] Navigation metadata is selected explicitly.
- [x] No shadcn-specific section/group projection exists in core.

Tests:

- [x] Add runtime tests for normalized navigation node shape.
- [x] Add runtime tests for `firstPage`.
- [x] Add runtime tests for selected metadata fields.
- [x] Add runtime tests for nested routes and active path helpers.

Verification:

- [x] `pnpm build:packages`
- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] `pnpm docs:build`
- [x] Focused navigation/public API contracts:
      `pnpm exec vitest run --config vitest.config.ts test/contracts/app-query-contracts.test.ts test/contracts/package-exports-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts`

Consumer validation:

- [x] Replace local first-page recursion in `saas-template`.
- [x] Replace local first-page recursion in `saas-i18n`.
- [x] Use normalized navigation in `shadcn-starter` without adding a core
      shadcn projection.

Commit checkpoint:

- [x] Commit navigation composable.

Suggested commit message:

```txt
feat(content): add normalized content navigation
```

## Phase 4: Search Contracts

Goal: make public search scope explicit, typed, and route-safe.

Scope:

- [x] Add `collection` to every search result.
- [x] Default public search data to routable page collections.
- [x] Exclude `type: 'data'` collections from public route search by default.
- [x] Allow explicit opt-in for intentional data-collection search.
- [x] Keep the headless search helper explicitly imported in shadcn-style apps.
- [x] Do not infer collection type only from URL prefixes.

Acceptance criteria:

- [x] Search results include `collection`.
- [x] Public search excludes data collections by default.
- [x] Apps can configure search scope without duplicating UI copy.
- [x] Search result routing is based on result identity, not string prefix hacks.

Tests:

- [x] Add search index tests for default page-only scope.
- [x] Add search index tests for explicit data collection opt-in.
- [x] Add search result type tests for `collection`.
- [x] Add route tests for localized search results if localized search is in
      scope.

Verification:

- [x] `pnpm build:packages`
- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] `pnpm docs:build`
- [x] Focused search contracts:
      `pnpm exec vitest run --config vitest.config.ts test/unit/search-behavior.test.ts test/unit/pagefind.test.ts test/runtime/search-collection-defaults.test.ts test/runtime/api-search-boundaries.test.ts test/client/search-composables.test.ts`

Consumer validation:

- [x] Update `saas-template` search to use `collection`.
- [x] Update `saas-i18n` search to use locale-aware route identity.
- [x] Update `shadcn-starter` search scope and result routing.

Commit checkpoint:

- [x] Commit search contract changes.

Suggested commit message:

```txt
feat(content): include collection identity in search results
```

## Phase 5: Content Head Helper

Goal: centralize repeated SEO/head extraction without hiding ownership.

Scope:

- [x] Add explicit `useContentHead(page)`.
- [x] Support title, description, image, and canonical route where already
      available.
- [x] Keep the helper explicit-only.
- [x] Do not make `useContentPage` mutate head automatically in this phase.

Target API:

```ts
const { page } = await useContentPage('docs')

useContentHead(page)
```

Acceptance criteria:

- [x] Consumers can delete local page-to-head mapping helpers.
- [x] Missing optional SEO fields do not produce invalid head tags.
- [x] Head ownership remains visible at the call site.

Tests:

- [x] Add tests for common page metadata.
- [x] Add tests for missing optional metadata.
- [x] Add type tests for accepted page shape.

Verification:

- [x] `pnpm build:packages`
- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] `pnpm docs:build`
- [x] Focused head/public API contracts:
      `pnpm exec vitest run --config vitest.config.ts test/contracts/content-head-contracts.test.ts test/contracts/app-query-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts`
- [x] Package export contract:
      `pnpm exec vitest run --config vitest.config.ts test/contracts/package-exports-contracts.test.ts`

Consumer validation:

- [x] Replace duplicated SEO mapping in `saas-template`.
- [x] Replace duplicated SEO mapping in `saas-i18n`.
- [x] Confirm shadcn app can keep local SEO ownership; the helper has no Nuxt UI
      assumptions.

Commit checkpoint:

- [x] Commit content head helper.

Suggested commit message:

```txt
feat(content): add explicit content head helper
```

## Phase 6: Relationship Queries And Population

Goal: move relationship filtering and population out of Vue components.

Scope:

- [x] Keep explicit populate mapping as the default:
      `populate: { author: 'authors' }`.
- [x] Do not ship `populate: ['author']` until reference fields are
      unambiguous in schema and provider behavior.
- [x] Improve typed populated references at call sites.
- [x] Improve or document `useContentBacklinks` before adding a new
      `useContentReferences` API.
- [x] Avoid fetching all posts and filtering refs in frontend components.

Acceptance criteria:

- [x] `populate: { author: 'authors' }` returns typed populated author data.
- [x] Author pages can query related posts without fetching all posts.
- [x] Backlink/reference behavior has one documented source of truth.
- [x] No new relationship API is added unless existing backlinks cannot express
      the required query.

Tests:

- [x] Add type tests for populated single reference.
- [x] Add type tests for populated reference arrays.
- [x] Add provider tests for reference filtering.
- [x] Add runtime tests for author-to-post lookup.

Verification:

- [x] `pnpm build:packages`
- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] Focused populate/backlink contracts:
      `pnpm exec vitest run --config vitest.config.ts test/ginko-unified-populate.test.ts test/client/consumer-flows.test.ts`

Consumer validation:

- [x] Update author page in `saas-template` or `saas-i18n`.
- [x] Remove frontend all-posts filtering where relationship queries can do the
      work.

Commit checkpoint:

- [x] Commit typed population and relationship query improvements.

Suggested commit message:

```txt
feat(content): type populated content references
```

## Phase 7: Renderer Fallback

Goal: prevent unsupported renderer input from leaking diagnostic JSON into
production UI.

Scope:

- [x] Audit `<ContentRenderer>` unsupported input handling.
- [x] Replace production debug JSON with a safe fallback.
- [x] Keep useful development diagnostics.
- [x] Add a warning path that helps developers fix incorrect slot usage.

Acceptance criteria:

- [x] Production renderer output never shows raw diagnostic JSON.
- [x] Development mode still gives actionable feedback.
- [x] Incorrect renderer input is covered by tests.

Tests:

- [x] Add renderer tests for unsupported input in production mode.
- [x] Add renderer tests for unsupported input in development mode.
- [x] Add tests for slot-based fallback behavior.

Verification:

- [x] `pnpm build:packages`
- [x] `pnpm test`
- [x] `pnpm docs:build`
- [x] Focused renderer contract:
      `pnpm exec vitest run --config vitest.config.ts test/contracts/render-components-contracts.test.ts`

Consumer validation:

- [x] Confirm affected pages in `saas-template` render cleanly.
- [x] Confirm affected pages in `saas-i18n` render cleanly.

Commit checkpoint:

- [x] Commit renderer fallback fix.

Suggested commit message:

```txt
fix(content): avoid debug renderer output in production
```

## Phase 8: Consumer Cutover

Goal: validate the new API against real Nuxt UI and shadcn consumers.

Scope:

- [x] Use local source or packed package consistently for each consumer
      validation run.
- [x] Prefer `link:../ginko-content/packages/content` or a scripted pack/install
      flow over stale manual tarballs.
- [x] Update `saas-template`.
- [x] Update `saas-i18n`.
- [x] Update `shadcn-starter`.
- [x] Delete old local wrappers and adapters made obsolete by the new API.
- [x] Do not keep old and new consumer paths side by side.

Acceptance criteria:

- [x] Consumer pages use typed string collection names in `saas-template`.
- [x] Docs pages use `useContentPage` in `saas-template`.
- [x] Sidebars use `useContentNavigation` in `saas-template`.
- [x] Search routing uses result identity including `collection` in
      `saas-template`.
- [x] SEO/head mapping uses `useContentHead` in `saas-template`.
- [x] Obsolete helpers are deleted.

Verification:

- [x] Run each consumer's lint/check command.
- [x] Run `saas-template` lint command.
- [x] Run `saas-i18n` lint command.
- [x] Run `shadcn-starter` check command.
- [x] Run each consumer's typecheck command.
- [x] Run `saas-template` typecheck command.
- [x] Run `saas-i18n` typecheck command.
- [x] Run `shadcn-starter` typecheck command.
- [x] Run each consumer's build command.
- [x] Run `saas-template` build command.
- [x] Run `saas-i18n` build command.
- [x] Run `shadcn-starter` build command.
- [x] Open each consumer locally and check docs page, blog page, sidebar, search,
      localized page, and author page where applicable.

Commit checkpoint:

- [x] Commit `saas-template` cutover.
- [x] Commit `saas-i18n` cutover.
- [x] Commit `shadcn-starter` cutover.

Suggested commit messages:

```txt
refactor(app): use ginko content page APIs
refactor(app): use normalized ginko navigation
refactor(app): use ginko search result identity
```

## Phase 9: Config Identity Cleanup

Goal: remove duplicated collection identity after app-facing APIs prove out.

This is intentionally not first-cut work.

Scope:

- [x] Re-evaluate whether `defineCollection('docs')` is still worth deleting.
- [x] Make collection map keys the canonical identity.
- [x] Support `defineCollection({ ... })` without a name argument.
- [x] Assign runtime handle names from the resolved config map.
- [x] Decide whether `#content/collections` generated handles are genuinely
      useful or unnecessary.
- [x] Avoid keeping authored handles and generated handles as competing public
      sources of truth.

Acceptance criteria:

- [x] Collection identity has one canonical source.
- [x] Existing examples use the canonical source.
- [x] Generated handles exist only if they remove real complexity.
- [x] Migration notes are short and direct.

Tests:

- [x] Add config resolution tests for key-derived collection names.
- [x] Add type generation tests for key-derived names.
- [x] Add tests proving duplicate authored names cannot drift silently.

Verification:

- [x] `pnpm build:packages`
- [x] `pnpm lint`
- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] `pnpm verify`
- [x] Focused config/drift contracts:
      `pnpm exec vitest run --config vitest.config.ts test/unit/docs-drift.test.ts test/ginko-utils.test.ts test/contracts/module-contracts.test.ts`
- [x] Docs build:
      `pnpm docs:build`
- [x] Examples build:
      `pnpm examples:build`

Commit checkpoint:

- [x] Commit collection identity cleanup.

Suggested commit message:

```txt
refactor(content): derive collection identity from config keys
```

## Phase 10: Route Metadata Validation

Goal: reduce i18n route drift without hiding route ownership.

Scope:

- [x] Add validation or a helper that compares collection route mounts with page
      route metadata.
- [x] Do not auto-generate route meta until validation proves the drift problem
      and the desired ownership model.
- [x] Keep localized route mounts visible in config.
- [x] Emit actionable diagnostics for mismatches.

Acceptance criteria:

- [x] Drift between collection route config and page metadata is detected.
- [x] Diagnostics name the collection, locale, expected route, and page file.
- [x] Apps can fix mismatches without learning an extra routing system.

Tests:

- [x] Add validation tests for matching localized routes.
- [x] Add validation tests for route mismatch.
- [x] Add validation tests for missing locale route.

Verification:

- [x] `pnpm build:packages`
- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] `pnpm lint`
- [x] `pnpm docs:build`
- [x] Focused route metadata contracts:
      `pnpm exec vitest run --config vitest.config.ts test/contracts/route-meta-validation-contracts.test.ts test/contracts/module-contracts.test.ts`

Commit checkpoint:

- [x] Commit route metadata validation.

Suggested commit message:

```txt
feat(content): validate localized route metadata
```

## Phase 11: Documentation And Examples

Goal: make the new API the documented default.

Scope:

- [x] Update docs examples to use typed string collection names.
- [x] Update page examples to use `useContentPage`.
- [x] Update navigation examples to use `useContentNavigation`.
- [x] Update search examples to show result `collection`.
- [x] Update SEO examples to show `useContentHead`.
- [x] Keep low-level query docs explicit-import based.
- [x] Add migration notes with before/after snippets.

Acceptance criteria:

- [x] Docs first page shows the new Nuxt-like API.
- [x] Advanced docs still explain direct query primitives.
- [x] Migration notes mention fallback remains explicit.
- [x] Migration notes document collection map-key identity and the compatibility
      form for authored names.

Verification:

- [x] `pnpm docs:build`
- [x] `pnpm examples:build`
- [x] `pnpm lint`

Commit checkpoint:

- [x] Commit docs and examples update.

Suggested commit message:

```txt
docs(content): document nuxt-first content APIs
```

## Phase 12: Final Verification And Release Prep

Goal: prove the complete change set is ready to ship.

Repository verification:

- [x] `pnpm lint`
- [x] `pnpm build:packages`
- [x] `pnpm docs:build`
- [x] `pnpm examples:build`
- [x] `pnpm test`
- [x] `pnpm test:e2e`
- [x] `pnpm typecheck`
- [x] `pnpm test:quickstart`
- [x] `pnpm pack:check`
- [x] `pnpm verify`

Consumer verification:

- [x] `saas-template`: install/link package from local source.
- [x] `saas-template`: lint.
- [x] `saas-template`: typecheck.
- [x] `saas-template`: build.
- [x] `saas-template`: manual check docs, blog, sidebar, search, SEO.
- [x] `saas-i18n`: install/link package from local source.
- [x] `saas-i18n`: lint.
- [x] `saas-i18n`: typecheck.
- [x] `saas-i18n`: build.
- [x] `saas-i18n`: manual check localized docs, fallback, search, sidebar,
      SEO.
- [x] `shadcn-starter`: install/link package from local source.
- [x] `shadcn-starter`: lint/check.
- [x] `shadcn-starter`: typecheck.
- [x] `shadcn-starter`: build.
- [x] `shadcn-starter`: manual check docs navigation, search, and page render.

Final review:

- [x] No second source of truth was introduced.
- [x] Old helpers and wrappers were deleted where replaced.
- [x] No app-specific projection leaked into core.
- [x] Fallback behavior is explicit and tested.
- [x] Search result identity is explicit and tested.
- [x] Renderer production fallback is safe.
- [x] Public API changes are documented.
- [x] Changelog or release notes are prepared if this will be published.

Commit checkpoint:

- [x] Commit final docs, changelog, and release prep.

Suggested commit message:

```txt
chore(content): prepare dream experience release
```

## Parking Lot

These are intentionally not first-cut tasks. Revisit only when a concrete
consumer problem proves they are needed.

- [ ] Generated `#content/collections` handles.
- [ ] Automatic route meta generation.
- [ ] `populate: ['author']` shorthand.
- [ ] New `useContentReferences` API.
- [ ] Markdown tag conventions.
- [ ] Core shadcn section/group projection.
- [ ] Automatic head mutation inside `useContentPage`.
- [ ] CMS, Studio, MCP, or editing workflow APIs.
