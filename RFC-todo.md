# RFC Todo: Dream Experience Implementation

Status: draft
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
- [ ] Capture current consumer friction with short before examples from:
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
- [ ] `pnpm test`
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
- [ ] Update planned navigation/search APIs to accept typed collection names
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
- [ ] `pnpm test`
- [x] Focused contract tests:
      `pnpm exec vitest run --config vitest.config.ts test/contracts/module-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts`

Consumer validation:

- [ ] Convert one `saas-template` page to string collection API.
- [ ] Convert one `saas-i18n` page to string collection API.
- [ ] Convert one `shadcn-starter` page or query helper to string collection
      API.
- [ ] Confirm no consumer imports `content.config.ts` only to pass a collection
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
- [ ] Infer active Nuxt locale when the collection is localized and no explicit
      locale is provided.
- [ ] Keep explicit `locale` override support.
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
- [ ] Locale-aware page lookup uses active Nuxt locale by default.
- [ ] Fallback content appears only when `fallback: true` is passed.
- [x] `surround` is available from the same composable call.
- [ ] Consumers do not need a Nuxt UI surround adapter in page components.

Tests:

- [x] Add Nuxt runtime tests for route inference.
- [ ] Add Nuxt runtime tests for explicit locale override.
- [ ] Add Nuxt runtime tests for explicit fallback.
- [x] Add Nuxt runtime tests for `surround`.
- [x] Add type tests for the returned `page` alias.

Verification:

- [x] `pnpm build:packages`
- [ ] `pnpm test -- --project nuxt`
- [x] `pnpm typecheck`
- [ ] `pnpm docs:build`
- [x] Focused page contract tests:
      `pnpm exec vitest run --config vitest.config.ts test/contracts/use-content-page-contracts.test.ts`

Consumer validation:

- [ ] Update docs page in `saas-template`.
- [ ] Update localized docs page in `saas-i18n`.
- [ ] Confirm fallback use in `saas-i18n` is visible in the call site.

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

- [ ] Docs sidebars can render without local recursive "find first page" code.
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
- [ ] `pnpm test`
- [x] `pnpm typecheck`
- [ ] `pnpm docs:build`
- [x] Focused navigation/public API contracts:
      `pnpm exec vitest run --config vitest.config.ts test/contracts/app-query-contracts.test.ts test/contracts/package-exports-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts`

Consumer validation:

- [ ] Replace local first-page recursion in `saas-template`.
- [ ] Replace local first-page recursion in `saas-i18n`.
- [ ] Use normalized navigation in `shadcn-starter` without adding a core
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
- [ ] `pnpm test`
- [x] `pnpm typecheck`
- [ ] `pnpm docs:build`
- [x] Focused search contracts:
      `pnpm exec vitest run --config vitest.config.ts test/unit/search-behavior.test.ts test/unit/pagefind.test.ts test/runtime/search-collection-defaults.test.ts test/runtime/api-search-boundaries.test.ts test/client/search-composables.test.ts`

Consumer validation:

- [ ] Update `saas-template` search to use `collection`.
- [ ] Update `saas-i18n` search to use locale-aware route identity.
- [ ] Update `shadcn-starter` search scope and result routing.

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

- [ ] Consumers can delete local page-to-head mapping helpers.
- [x] Missing optional SEO fields do not produce invalid head tags.
- [x] Head ownership remains visible at the call site.

Tests:

- [x] Add tests for common page metadata.
- [x] Add tests for missing optional metadata.
- [x] Add type tests for accepted page shape.

Verification:

- [x] `pnpm build:packages`
- [ ] `pnpm test`
- [x] `pnpm typecheck`
- [ ] `pnpm docs:build`
- [x] Focused head/public API contracts:
      `pnpm exec vitest run --config vitest.config.ts test/contracts/content-head-contracts.test.ts test/contracts/app-query-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts`
- [x] Package export contract:
      `pnpm exec vitest run --config vitest.config.ts test/contracts/package-exports-contracts.test.ts`

Consumer validation:

- [ ] Replace duplicated SEO mapping in `saas-template`.
- [ ] Replace duplicated SEO mapping in `saas-i18n`.
- [ ] Confirm shadcn app can use the helper without Nuxt UI assumptions.

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
- [ ] `pnpm test`
- [x] `pnpm typecheck`
- [x] Focused populate/backlink contracts:
      `pnpm exec vitest run --config vitest.config.ts test/ginko-unified-populate.test.ts test/client/consumer-flows.test.ts`

Consumer validation:

- [ ] Update author page in `saas-template` or `saas-i18n`.
- [ ] Remove frontend all-posts filtering where relationship queries can do the
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

- [ ] Audit `<ContentRenderer>` unsupported input handling.
- [ ] Replace production debug JSON with a safe fallback.
- [ ] Keep useful development diagnostics.
- [ ] Add a warning path that helps developers fix incorrect slot usage.

Acceptance criteria:

- [ ] Production renderer output never shows raw diagnostic JSON.
- [ ] Development mode still gives actionable feedback.
- [ ] Incorrect renderer input is covered by tests.

Tests:

- [ ] Add renderer tests for unsupported input in production mode.
- [ ] Add renderer tests for unsupported input in development mode.
- [ ] Add tests for slot-based fallback behavior.

Verification:

- [ ] `pnpm build:packages`
- [ ] `pnpm test`
- [ ] `pnpm docs:build`

Consumer validation:

- [ ] Confirm affected pages in `saas-template` render cleanly.
- [ ] Confirm affected pages in `saas-i18n` render cleanly.

Commit checkpoint:

- [ ] Commit renderer fallback fix.

Suggested commit message:

```txt
fix(content): avoid debug renderer output in production
```

## Phase 8: Consumer Cutover

Goal: validate the new API against real Nuxt UI and shadcn consumers.

Scope:

- [ ] Use local source or packed package consistently for each consumer
      validation run.
- [ ] Prefer `link:../ginko-content/packages/content` or a scripted pack/install
      flow over stale manual tarballs.
- [ ] Update `saas-template`.
- [ ] Update `saas-i18n`.
- [ ] Update `shadcn-starter`.
- [ ] Delete old local wrappers and adapters made obsolete by the new API.
- [ ] Do not keep old and new consumer paths side by side.

Acceptance criteria:

- [ ] Consumer pages use typed string collection names.
- [ ] Docs pages use `useContentPage`.
- [ ] Sidebars use `useContentNavigation`.
- [ ] Search routing uses result identity including `collection`.
- [ ] SEO/head mapping uses `useContentHead`.
- [ ] Obsolete helpers are deleted.

Verification:

- [ ] Run each consumer's lint command.
- [ ] Run each consumer's typecheck command.
- [ ] Run each consumer's build command.
- [ ] Open each consumer locally and check docs page, blog page, sidebar, search,
      localized page, and author page where applicable.

Commit checkpoint:

- [ ] Commit `saas-template` cutover.
- [ ] Commit `saas-i18n` cutover.
- [ ] Commit `shadcn-starter` cutover.

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

- [ ] Re-evaluate whether `defineCollection('docs')` is still worth deleting.
- [ ] If yes, make collection map keys the canonical identity.
- [ ] Support `defineCollection({ ... })` without a name argument.
- [ ] Generate any needed internal handles from resolved config.
- [ ] Decide whether `#content/collections` generated handles are genuinely
      useful or unnecessary.
- [ ] Avoid keeping authored handles and generated handles as competing public
      sources of truth.

Acceptance criteria:

- [ ] Collection identity has one canonical source.
- [ ] Existing examples use the canonical source.
- [ ] Generated handles exist only if they remove real complexity.
- [ ] Migration notes are short and direct.

Tests:

- [ ] Add config resolution tests for key-derived collection names.
- [ ] Add type generation tests for key-derived names.
- [ ] Add tests proving duplicate authored names cannot drift silently.

Verification:

- [ ] `pnpm build:packages`
- [ ] `pnpm lint`
- [ ] `pnpm test`
- [ ] `pnpm typecheck`
- [ ] `pnpm verify`

Commit checkpoint:

- [ ] Commit collection identity cleanup.

Suggested commit message:

```txt
refactor(content): derive collection identity from config keys
```

## Phase 10: Route Metadata Validation

Goal: reduce i18n route drift without hiding route ownership.

Scope:

- [ ] Add validation or a helper that compares collection route mounts with page
      route metadata.
- [ ] Do not auto-generate route meta until validation proves the drift problem
      and the desired ownership model.
- [ ] Keep localized route mounts visible in config.
- [ ] Emit actionable diagnostics for mismatches.

Acceptance criteria:

- [ ] Drift between collection route config and page metadata is detected.
- [ ] Diagnostics name the collection, locale, expected route, and page file.
- [ ] Apps can fix mismatches without learning an extra routing system.

Tests:

- [ ] Add validation tests for matching localized routes.
- [ ] Add validation tests for route mismatch.
- [ ] Add validation tests for missing locale route.

Verification:

- [ ] `pnpm build:packages`
- [ ] `pnpm test`
- [ ] `pnpm typecheck`

Commit checkpoint:

- [ ] Commit route metadata validation.

Suggested commit message:

```txt
feat(content): validate localized route metadata
```

## Phase 11: Documentation And Examples

Goal: make the new API the documented default.

Scope:

- [ ] Update docs examples to use typed string collection names.
- [ ] Update page examples to use `useContentPage`.
- [ ] Update navigation examples to use `useContentNavigation`.
- [ ] Update search examples to show result `collection`.
- [ ] Update SEO examples to show `useContentHead`.
- [ ] Keep low-level query docs explicit-import based.
- [ ] Add migration notes with before/after snippets.

Acceptance criteria:

- [ ] Docs first page shows the new Nuxt-like API.
- [ ] Advanced docs still explain direct query primitives.
- [ ] Migration notes mention fallback remains explicit.
- [ ] Migration notes mention config identity cleanup is phase-two/end-state
      unless implemented.

Verification:

- [ ] `pnpm docs:build`
- [ ] `pnpm examples:build`
- [ ] `pnpm lint`

Commit checkpoint:

- [ ] Commit docs and examples update.

Suggested commit message:

```txt
docs(content): document nuxt-first content APIs
```

## Phase 12: Final Verification And Release Prep

Goal: prove the complete change set is ready to ship.

Repository verification:

- [ ] `pnpm lint`
- [ ] `pnpm build:packages`
- [ ] `pnpm docs:build`
- [ ] `pnpm examples:build`
- [ ] `pnpm test`
- [ ] `pnpm test:e2e`
- [ ] `pnpm typecheck`
- [ ] `pnpm test:quickstart`
- [ ] `pnpm pack:check`
- [ ] `pnpm verify`

Consumer verification:

- [ ] `saas-template`: install/link package from local source.
- [ ] `saas-template`: lint.
- [ ] `saas-template`: typecheck.
- [ ] `saas-template`: build.
- [ ] `saas-template`: manual check docs, blog, sidebar, search, SEO.
- [ ] `saas-i18n`: install/link package from local source.
- [ ] `saas-i18n`: lint.
- [ ] `saas-i18n`: typecheck.
- [ ] `saas-i18n`: build.
- [ ] `saas-i18n`: manual check localized docs, fallback, search, sidebar,
      SEO.
- [ ] `shadcn-starter`: install/link package from local source.
- [ ] `shadcn-starter`: lint.
- [ ] `shadcn-starter`: typecheck.
- [ ] `shadcn-starter`: build.
- [ ] `shadcn-starter`: manual check docs navigation, search, and page render.

Final review:

- [ ] No second source of truth was introduced.
- [ ] Old helpers and wrappers were deleted where replaced.
- [ ] No app-specific projection leaked into core.
- [ ] Fallback behavior is explicit and tested.
- [ ] Search result identity is explicit and tested.
- [ ] Renderer production fallback is safe.
- [ ] Public API changes are documented.
- [ ] Changelog or release notes are prepared if this will be published.

Commit checkpoint:

- [ ] Commit final docs, changelog, and release prep.

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
