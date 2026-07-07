# Ginko Content — Foundational Refactor Playbook (`refactor-todo.md`)

> **Audience:** an autonomous AI coding agent (junior-level) executing this refactor task-by-task, plus a senior reviewer (human or stronger model) reviewing each phase.
> **Repo:** `ginko-content` (this repo). Package: `@lupinum/ginko-content`, currently `0.1.7`, published but pre-1.0 and in tinkerer phase → **hard cutovers are allowed and preferred. No compatibility shims for internals.**
> **Companion doc:** the full review lives at `../ginko-cms/REVIEW_GINKO_CONTENT_AND_CMS.md`. Finding IDs referenced below (GC-1, GC-2, …) are defined there.
> **Outcome:** production content served from one sealed build snapshot; one document envelope; one query vocabulary at every boundary; a directory tree that tells the truth; a smaller, sharper public surface; behavior-first tests.

---

## 0. Agent kickoff prompt (copy-paste to start the agent)

```text
You are executing a planned foundational refactor of the ginko-content repository.
Your single source of instructions is the file `refactor-todo.md` at the repo root.

Rules of engagement:
1. Read `refactor-todo.md` COMPLETELY before writing any code. Then read the
   referenced source files of the task you are about to do.
2. Work strictly in order: Phase 1 → Phase 7, task by task (T1.1, T1.2, …).
   Never start a task while the previous task's verification is red.
3. One task = one commit. Commit message format: "refactor(T<phase>.<n>): <task title>".
   Never push, never publish, never run any `release:*` or `publish` script.
4. Before each task: re-read its Acceptance Criteria and its STOP conditions.
   After each task: run its Verify commands, then run the global gate
   (`pnpm -r typecheck && pnpm test` from the repo root, or the commands in §3).
5. For any task marked [CORNERSTONE], you MUST use the reference implementation
   in §12 as your starting point. Adapt names/imports to the real code, but do
   not change the stated invariants. If the real code contradicts a cornerstone
   assumption, STOP and record the contradiction in the Status Log instead of
   improvising.
6. Maintain the Status Log (§2) in this file: mark each task [x] with the
   commit hash, or [BLOCKED: reason]. Append discoveries under "Deviations".
7. Deletion is the preferred tool. When a task says delete, delete — do not
   comment out, do not keep a renamed copy, do not add a deprecation shim.
8. Do not modify anything under `../ginko-cms/` — cross-repo impacts are
   handled separately (§9). Do not edit files under `dist/`, `node_modules/`,
   or `test/fixtures/**/generated*`.
9. STOP and ask for review when: a task's STOP condition triggers; a change
   would alter the behavior of `./cms-contract` or `./cms-import` exports
   beyond what a task explicitly authorizes; you need to touch more than ~25
   files in one task that the task didn't predict; or the global gate stays
   red after two focused fix attempts.
10. You are cheap and fast; the reviewer is expensive. Prefer small verifiable
    steps over clever big ones. When in doubt, choose the boring option.
Begin with Phase 1, task T1.1.
```

---

## 1. Mission and target architecture

### Where we are (verified in code)

- Production requests **rebuild the entire content graph per request**: `src/storage/graph.ts:8-17` memoizes on `event.context.__contentRuntime.memo` (request-scoped, `src/integrations/nitro/context.ts:60-99`), and `src/storage/contents.ts:89-96` re-loads every parsed artifact in chunks of 10 on each request.
- The production corpus is **whatever the prerender warm route wrote** (`/api/…/cache.<integrity>.json`, `src/module/server-handlers.ts:49-51` → `src/runtime/server/api/cache.ts`); `src/integrations/nitro/storage.ts:86-92` reads ids from the parsed cache with no completeness check → documents can be silently missing in prod (GC-2).
- Two document vocabularies coexist: legacy underscore meta (`_id`, `_path`, `_collection`, `_locale`, `_canonicalKey`, `_type`, `_extension` — `src/types/content.ts:25-106,317-321`, ~20 files) and the modern envelope (`path`, `locale`, `localePaths`, `variants`, `resolved`).
- Two query vocabularies coexist: the retired open-ended `ContentQueryBuilderParams` (`src/types/query-parts/transport.ts:39-57`, with `[key: string]: unknown`) is still the **provider wire contract** (`src/public/provider.ts:88`), while the clean `ContentQueryPlan` AST (`src/core/query/plan.ts`) is documented as "the stable boundary" but isn't used as one.
- The tree has 15 top-level src dirs vs 8 documented; `runtime/` (7,784 LOC) contains framework-free domain logic (`runtime/query/` ≈1,315 LOC, `runtime/server/agent-markdown.ts` ≈701 LOC).

### Where we're going (the dream state this file implements)

1. **Sealed snapshot pipeline (Phase 2).** Build produces one versioned snapshot (all parsed documents + integrity + counts). Production loads it once per process, builds the graph once per process, and never touches the lazy per-document machinery. Dev keeps watch-and-reparse. Completeness is asserted at build time — a missing document fails the build, never a request.
2. **One envelope, one vocabulary (Phase 3).** Underscore meta deleted; a single canonical document envelope; the provider wire contract is a closed, versioned, JSON-pure query plan. The old transport types are deleted.
3. **Honest tree (Phase 4).** `core/` = all framework-free domain logic (including query compilation and agent-markdown serialization); `runtime/` + `module/` = thin Nuxt/Nitro adapters; `cms-contract` + `cms-import` = the CMS-facing surface. `cms-exchange` is gone.
4. **Sharp public surface (Phase 5).** Curated root exports; no wildcard type leaks; one home per concept; the `slug === 'docs'` heuristic and other CMS-policy leaks removed; the two i18n type holes closed.
5. **Behavior-first tests (Phase 6)** and **safe releases (Phase 7).**

### Phase order and why

Phases 1–2 are independent of Phase 3. Phase 3 (envelope/wire) must land **before** Phase 4 (tree re-cut) so the mechanical move doesn't double the rename diff. Phase 5 depends on 3 (it deletes types Phase 3 orphans). Phase 6–7 last. Do not reorder.

---

## 2. Status Log (maintained by the agent)

> Mark tasks as you complete them. Never delete entries. Add deviations at the bottom.

```
Phase 1: [x] T1.1 (commit: d49c87c)  [x] T1.2 (commit: this commit)  [ ] T1.3  [ ] T1.4  [ ] T1.5
Phase 2: [ ] T2.1  [ ] T2.2  [ ] T2.3  [ ] T2.4  [ ] T2.5
Phase 3: [ ] T3.1  [ ] T3.2  [ ] T3.3  [ ] T3.4
Phase 4: [ ] T4.1  [ ] T4.2  [ ] T4.3
Phase 5: [ ] T5.1  [ ] T5.2  [ ] T5.3  [ ] T5.4  [ ] T5.5  [ ] T5.6
Phase 6: [ ] T6.1  [ ] T6.2  [ ] T6.3
Phase 7: [ ] T7.1  [ ] T7.2  [ ] T7.3
```

**Deviations / discoveries:**
- T1.1: `pnpm -r typecheck` is red before `pnpm test` in `examples/advanced/cms-cache-contract`, where Nuxt typecheck reports missing `setResponseStatus` and `useContentPage` exports from `#imports` for `packages/content/src/runtime/app/pages/content.vue`. The generated example `.nuxt/imports.d.ts` does contain both symbols. Used the §3 gate alternative `pnpm typecheck && pnpm test`, which passed.

---

## 3. Verification protocol (run constantly)

From `packages/content/` unless noted:

| Gate | Command | When |
|---|---|---|
| Types | `pnpm typecheck` (or `pnpm -r typecheck` at root) | after every task |
| Unit + contracts | `pnpm test` (vitest) | after every task |
| Build | `pnpm build` (or `pnpm prepack`) | after tasks touching module/build/exports |
| Playground smoke | `pnpm -C ../../playground/ginko-basic dev:build` equivalent — use the repo's existing script; if none, `nuxi build playground/ginko-basic` from repo root | after Phases 2, 3, 4 |
| i18n playground smoke | build `playground/ginko-i18n` | after Phases 2, 3 |
| Type fixtures | the `test/fixtures/typecheck` suite (runs under `pnpm test` or its own script — locate in package.json) | after Phases 3, 5 |
| Full gate | repo's `release:verify` **minus any publish step** | end of each phase |

Self-review checklist before marking any task done:
- [ ] Verify commands green.
- [ ] `git diff --stat` matches the task's predicted blast radius (±30%). If wildly larger, STOP.
- [ ] No new `any` casts introduced except where a task allows it.
- [ ] No TODO/FIXME left without a Status Log entry.
- [ ] Deleted code is deleted (grep for the old symbol name returns only CHANGELOG/docs history).
---

## 4. Phase 1 — Hygiene and deletions (low risk, do first)

### T1.1 Delete dead files and dead config
- **Delete:** `RFC-todo.md`; `qa-evidence/` (git-tracked screenshots of external apps); `meta/skill/SKILL.md` (points at a hardcoded foreign path; `skills/ginko-content/` remains the real skill); `CMS-SPEC.md` (2,326 lines, describes a pre-seam integration that never mentions `/cms-contract`; ginko-cms owns CMS docs per ADR-0013).
- **Edit:** remove the nonexistent `test/ginko-query.test.ts` include from `vitest.config.ts` (~line 56).
- **Accept:** `pnpm test` green; `git grep -l "CMS-SPEC"` shows only CHANGELOG/ADR mentions (update any live doc links to point at the ginko-cms docs).
- **Risk:** none. **STOP if:** any *source* file imports from a deleted path.

### T1.2 Delete `cms-exchange` (subpath + source + tests)
- **Why:** 717 LOC, zero external consumers (ginko-cms uses its own `packages/cms/src/migration/`), index-based manifest pairing bug, MVP-only semantics (review GC-7 / boundary C5).
- **Do:** delete `src/cms-exchange/`; remove the `./cms-exchange` entry from `packages/content/package.json` exports; delete `test/unit/cms-exchange.test.ts`; remove the subpath from `meta/public-surface.json` and any docs pages mentioning it; remove the alias symbol `createCmsFilesystemImportPlan` everywhere.
- **Accept:** build green; `git grep cms-exchange` → only CHANGELOG/ADR history. Add a CHANGELOG "Unreleased → Removed" entry.
- **STOP if:** anything under `src/` (not tests) imports `cms-exchange` — record it, it means the review's "zero consumers" claim broke since.

### T1.3 Fix stale meta docs (cheap truth restoration)
- `meta/VISION.md` (~line 66): replace the retired `useContentOne({ by: { route } })` example with `useContentPage`.
- `meta/ABSTRACTIONS.md` (~lines 148-157): replace the hand-listed subpath list with one sentence deferring to `meta/public-surface.json` as the single source.
- `src/cms-contract/types.ts` (~lines 114-127): the doc comment on `CmsSchemaArtifactRef` claims the artifact is "behind a ref (rather than embedding it inline)" while the interface embeds `artifact: string`. Fix the comment to describe reality (embedded, checksummed).
- **Accept:** docs-drift test suite green.

### T1.4 Changelog/tag hygiene + publish preflight
- Backfill a `## v0.1.7` section in `CHANGELOG.md` (summarize from `git log v0.1.6..HEAD` — cms-exchange/provider-author changes; keep to honest bullets). Create annotated tag `v0.1.7` on the release commit if identifiable, else on the commit that set version 0.1.7 (do **not** push).
- Add a preflight guard used by *any* publish path (including `scripts/release-edge.sh`): refuse to publish when `CHANGELOG.md` lacks a section for `package.json` version, or the matching git tag is missing. Implement as `scripts/preflight-release.mjs` invoked at the top of the publish scripts; remove `--no-git-checks` from `release-edge.sh`.
- **Accept:** running the preflight with current state passes; with a version bumped but no changelog entry, fails with a clear message.

### T1.5 Deduplicate architecture-boundary tests
- Keep `test/unit/architecture-boundaries.test.ts` (TS-AST based) as the single boundary scanner; port into it the one unique check from `test/contracts/architecture-boundaries.test.ts` (public-surface naming, ~lines 71-102); delete the contracts copy.
- **Accept:** boundary violations still detected — prove it by temporarily adding `import 'h3'` to a `core/` file and watching the test fail, then revert.

---

## 5. Phase 2 — Sealed snapshot pipeline [THE BIG ONE]

**Goal:** production = load one snapshot per process, build graph once per process; build fails if the snapshot is incomplete. Dev/preview behavior unchanged. Kills GC-1 (per-request rebuild), GC-2 (silent missing docs), GC-12a (mtime cache staleness *in prod*).

**Design decisions (fixed — do not re-decide):**
- The snapshot stores **parsed documents, not the graph**. `ContentGraph` contains a `Map` (`referenceTargets`) and derived structures; serializing it invites version skew. Rebuilding the graph once per process from snapshot documents is cheap and reuses `buildContentGraph` unchanged.
- The snapshot is stored as **one item in the existing parsed-cache storage mount** (key `snapshot.json`, shape in CS-1). No new storage mounts, no new deployment surface — the parsed cache already ships with the server bundle.
- Per-document parsed-cache artifacts remain for **dev and prerender** only. The prod read path stops consulting them entirely.
- Process-scope memoization is keyed by `buildIntegrity` and uses single-flight (CS-3). `event`-scoped memoization stays for dev.

### T2.1 [CORNERSTONE CS-1 + CS-2] Snapshot types + build-time writer
- Create `src/core/content/snapshot.ts` with the types and `buildContentSnapshot` from CS-1 (pure, framework-free — it lives in `core/`).
- **Mechanism decision (fixed):** the writer is the existing prerendered cache route, repurposed. Document loading needs an H3 event (the whole `loadContentVariants` path takes `event`), which is exactly why the warm route exists — so rewrite `src/runtime/server/api/cache.ts` per CS-2: enumerate all source ids, load all documents through the existing loaders, `buildContentSnapshot`, run the completeness assertion (T2.2), write `snapshot.json` into the parsed-cache storage, and keep the `_nav.json` warm-up it already performs. The route stays registered at `cache.<integrity>.json` (`src/module/server-handlers.ts:49-51`) and stays in the prerender route list.
- The existing `prerender:init → compiled` hook area in `src/module/static-output.ts:47-53` gains a **verification** step only: assert `snapshot.json` exists and `isContentSnapshot` passes after prerender; fail the build otherwise (this catches "route wasn't prerendered" misconfigurations).
- **Accept:** after building `playground/ginko-basic`, the built server assets contain a `snapshot.json` whose `documentIds` length equals the number of content files (× locale variants) in the playground; the static-output verification fails the build when the route is removed from the prerender list (prove once locally, revert).
- **STOP if:** the cache route is not in the prerender route list for non-prerendered (pure SSR) deployments — then the snapshot must be written by a build step instead; record what you find in the Status Log and ask before improvising.

### T2.2 [CORNERSTONE CS-4] Build-time completeness assertion
- In the same writer, before persisting: enumerate source ids via the source driver (`runtime.source` / `getContentsIds`-equivalent build-side API) and assert `sourceIds ⊆ snapshot.documentSourceIds`. On mismatch **throw**, failing the build, with the missing ids listed.
- **Accept:** a fixture build where one file is force-skipped (temporarily filter it in the writer to simulate) fails with the file named; normal build passes. Add this as a real test (see T6.2).

### T2.3 [CORNERSTONE CS-3] Process-scope prod loader
- Create `src/storage/snapshot-runtime.ts` implementing `getProcessGraph()` per CS-3.
- Rewire `src/storage/graph.ts` `getContentGraph`: in production (and not prerendering), return `getProcessGraph()`; otherwise keep the current request-scoped path verbatim.
- Rewire `src/storage/contents.ts` `getContentsList` (and the id enumeration in `src/integrations/nitro/storage.ts:86-92`): in production, serve from the loaded snapshot's documents; delete the prod branches that consult per-document parsed cache (`contents.ts:48-50` short-circuit) — they are now dead.
- **Accept:** existing `test/runtime/*` boundary tests green; new test (T6.2) proves two sequential prod-mode requests observe the same graph object identity; playground prod build serves all routes.
- **STOP if:** any provider other than the filesystem provider reads `getContentGraph` — check `git grep -n getContentGraph` first and list callers in the Status Log before editing.

### T2.4 Remove the dead lazy-prod machinery
- After T2.1–T2.3 the prod read path serves from the snapshot. Delete the now-dead code: the prod short-circuit branches in `src/storage/contents.ts` (`isProduction && !isPrerendering && cached` at ~lines 48-50), the parsed-cache id enumeration fallback for prod in `src/integrations/nitro/storage.ts:86-92`, and any `isProduction` forks these leave unreachable. The per-document parsed cache remains for dev/prerender.
- Check whether `_nav.json` (written by the snapshot route) still has readers (`git grep "_nav.json"`); if nothing reads it anymore, stop writing it and note the deletion.
- **Accept:** prod playground build serves all routes; `git grep -n "isProduction" src/storage src/integrations` — each remaining hit is justifiable in one sentence (add that sentence as a code comment only where the constraint is non-obvious).
- **STOP if:** deleting a branch changes prerender behavior (prerender uses the dev-style path by design — `isPrerendering` must keep routing to it).

### T2.5 Content-hash the dev parsed cache (small, closes GC-12a for dev too)
- `src/storage/contents.ts:53-64`: the artifact hash uses `{mtime, size, …}`. Since the raw body is read on every miss anyway, hash the body (`ohash(body)` folded into the existing hash object, replacing mtime/size) so same-size/same-mtime edits can't serve stale parses.
- **Accept:** existing storage tests green; add one test: write file, parse, rewrite with same length + forced same mtime, parse again → new content returned.

---

## 6. Phase 3 — One envelope, one wire vocabulary [HIGHEST BLAST RADIUS]

**Goal:** delete underscore meta; make `ContentQueryPlan` the only cross-boundary query type; delete `ContentQueryBuilderParams` and friends. This is a **hard cutover** — no aliases, no dual acceptance. Package version becomes `0.2.0` (T7.1). ginko-cms impact is catalogued in §9 — do not fix it from this repo.

### T3.1 [CORNERSTONE CS-6] Canonical envelope — types first, compiler-driven
- In `src/types/content.ts`, apply the rename map of CS-6 to `ParsedContent` (and the related result types at ~lines 317-321). Delete every underscore field. Keep `canonicalKey` **internal**: move it to the internal-meta interface (`ParsedContentInternalMeta` or equivalent) and ensure it is stripped from provider-facing/public result shapes.
- Then chase the compiler: `pnpm typecheck` and fix every error mechanically per the map. Expected blast radius: ~20 src files + tests + `src/testing/provider-fixture.ts` + `examples/advanced/cms-cache-contract/`.
- The missing-document stub in `src/storage/contents.ts` (`{ _id: contentId, body: null }`) becomes the typed `MissingDocument` from CS-6.
- **Accept:** typecheck + full tests green; `git grep -nE '\b_(id|path|collection|locale|canonicalKey|type|extension)\b' src/ | grep -v internal-meta` returns nothing (allow a single documented exception if a transformer contract truly needs one — record it).
- **STOP if:** the blast radius exceeds ~60 files, or frontmatter parsing itself (user files can contain `_draft`-style keys — those are *user data*, not meta; do not rename user frontmatter handling) becomes ambiguous.

### T3.2 [CORNERSTONE CS-5] Provider wire contract v1
- Create `src/public/provider-query.ts` with `ContentProviderQuery` per CS-5 (JSON-pure plan envelope). Change `ContentProvider.query`/`navigationQuery` (`src/public/provider.ts:88-90`) to take it. Update the internal call sites that construct provider queries (`src/runtime/server/provider-query.ts` and the providers registry `src/runtime/server/providers/index.ts`) to lower builder params → plan **before** the provider boundary, using the existing `lowerQueryPlan`.
- Update capability validation (`providers/index.ts:55-180`) to validate against the plan (operators from `FilterExpr`, `limit/skip/count` from plan fields) — this gets *stronger*, not weaker.
- Update `src/testing/provider-fixture.ts` + conformance suite to the new wire type.
- **Accept:** provider conformance tests green; `test/contracts/provider-contracts.test.ts` and `query-plan-contracts.test.ts` green (update them to the new type — they may currently assert the old shape).
- **STOP if:** any query feature reaching providers today cannot be expressed in `ContentQueryPlan` (grep what fields of `ContentQueryBuilderParams` are actually read by the filesystem provider first; list them against CS-5's envelope before coding).

### T3.3 Delete the retired transport vocabulary
- Delete `ContentQueryBuilderParams`, `ContentQueryBuilderWhere`, `ContentQueryBuilder`, `QueryGroupBuilder`, `CollectionQueryOperator` (string-operator variant) from `src/types/query-parts/transport.ts` — keep only what still has live imports after T3.2, and inline/rename those into non-public internal modules if they are purely internal plumbing (e.g. the sitemap feature was noted as the last internal user of builder plumbing — convert it to construct a `ContentQueryPlan` directly).
- **Accept:** `git grep -n "ContentQueryBuilderParams"` → zero hits; typecheck green.

### T3.4 Single normalization seam for provider results
- Create one helper (e.g. `src/runtime/server/provider-result.ts` extension) that takes a provider's raw document and produces the canonical envelope, so third-party providers emit **only** the envelope fields CS-6 marks as provider-required; core derives the rest (`canonicalKey`, resolved variants). Update `examples/advanced/cms-cache-contract/server/cms-provider.ts` to the minimal required set — the example is the de-facto provider tutorial.
- **Accept:** provider fixture conformance green with a fixture that emits only the minimal set.
---

## 7. Phase 4 — Directory re-cut (mechanical, after Phase 3)

### T4.1 Move query compilation into core
- Move `src/runtime/query/` → `src/core/query/compile/` (or merge file-by-file into `src/core/query/` where natural). These files were verified framework-free. Update imports; keep git history with `git mv`.
- **Accept:** boundary test still proves `core/` has no framework imports; typecheck green; no file in `core/` imports from `runtime/`.

### T4.2 Extract the agent feature
- Move the pure serializer core of `src/runtime/server/agent-markdown.ts` (~701 LOC; its only H3 dependency is a type import) and `agent-site.ts` into `src/features/agent/`; leave thin H3 handlers in `runtime/server/`. Replace the module-global mutable `serializers` Map (`agent-markdown.ts:74`) with a per-app registry created during module setup and passed/injected — the global accumulates under dev HMR.
- **Accept:** agent e2e/contract tests green; `git grep -n "new Map" src/features/agent` shows the registry is instantiated per app, not at module scope.

### T4.3 Update the architecture docs to the real tree
- Rewrite the layer diagram + rules in `packages/content/ARCHITECTURE.md` and amend ADR-0010 (add an addendum section, don't falsify history) to name all top-level dirs (`core`, `features`, `storage`, `parsers`, `runtime`, `module`, `integrations`, `cms-contract`, `cms-import`, `cli`, `testing`, `types`, `public`, `utils`, `config`) with allowed dependency edges. The boundary test (T1.5) is the enforcement; the doc must match it.
- **Accept:** a new contributor could predict where a file lives from the doc alone; docs-drift suite green.

---

## 8. Phase 5 — Public surface hardening

### T5.1 Curate the root entry (GC-4)
- Replace `export type * from './types'` in `src/module.ts:43` with an explicit list. Start from: `ModuleOptions`, `ContentCollectionHandle`, the canonical envelope types (`ContentDocument`/`ParsedContent` post-rename, `NavItem`, `Toc`, `TocLink`), and whatever `git grep -l "from '@lupinum/ginko-content'"` in `docs/`, `playground/`, and `examples/` proves is actually used. Everything else is cut.
- Extend `test/contracts/package-exports-contracts.test.ts` to enumerate root-entry symbols against `meta/public-surface.json` the same way client/server facades are enforced.
- **Accept:** typecheck of `test/fixtures/typecheck` + playgrounds green; exports contract test covers the root.

### T5.2 Split the server facade; one home per concept (GC-8)
- Create `./agent` subpath (new `src/public/agent.ts`) and move the ~31 agent exports out of `src/public/server.ts`; remove the provider-type re-exports from `server.ts` (single home: `./provider`); move the 3 agent path helpers out of `./client` into `./agent` too.
- Delete the `./toc` subpath (hard cut — 0.2.0 is a breaking release anyway); `./client` already exports the same symbols.
- Update `meta/public-surface.json`, package.json exports, docs.
- **Accept:** exports contract green; `git grep -n "from '@lupinum/ginko-content/toc'"` in docs/playgrounds → zero.

### T5.3 Fix the transformers wildcard (GC-12c)
- Replace `"./transformers/*"` in package.json exports with explicit entries for the real transformers (`markdown`, `yaml`, `json`, `csv`) each with a `types` condition; keep `./transformers` → `defineTransformer`.
- **Accept:** `pnpm build` then a script asserts `require.resolve`/import works for each listed entry and fails for `./transformers/utils`.

### T5.4 De-CMS the config types (GC-6)
- Delete the `slug === 'docs'` (and sibling name checks) branch in `src/cms-contract/build.ts:223-231`; collection type must come from explicit `cms.type` config — when absent, default to `'flat'` (or whatever the current explicit default is) and emit a build-time warning telling the user to declare it.
- Narrow `ContentCmsFieldConfig` (`src/types/config.ts:29-103`): keep semantic facts (type, required, localized, relation target, options); move pure layout policy (`width`, `order`, `hidden`, `condition`) into a single `editor?: Record<string, unknown>` passthrough bag that ginko-content stores and forwards **without typing it** — ginko-cms owns its schema. Keep `ContentCmsFieldType` as the single vocabulary union (ginko-cms will re-export it — §9).
- **Accept:** `test/unit/cms-contract-*.test.ts` updated + green; contract build snapshot in tests shows `editor` passthrough preserved byte-for-byte.
- **STOP if:** removing the width/order typings breaks `buildCmsContract` output *shape* in a way not representable by the passthrough — record the exact fields.

### T5.5 [CORNERSTONE CS-7] Close the two i18n type holes (GC-9)
- Apply CS-7: `TreeOptions` composes `LocaleOption<H>`; `many`/`tree` (and any other verb with a defaulted options parameter) must not accept a missing options object for i18n handles.
- Add the negative type tests from CS-7 to `test/fixtures/typecheck/types/ginko-api.ts`.
- **Accept:** the two new `@ts-expect-error` cases fail to compile when the fix is reverted (prove once by reverting locally), pass with the fix.

### T5.6 Rename/parameterize the provider conformance suite (GC-12d)
- In `src/testing/provider-contract.ts`: rename `runSaasProviderFixtureContractSuite` → `runProviderContractSuite` (hard cut) and make expected capabilities a parameter — each capability block of assertions runs only when the provider declares that capability true, and *asserts the typed error* when declared false. Rename `createSaasProviderFixture` → `createProviderFixture`.
- **Accept:** the fixture provider passes with all-true; a locally constructed minimal provider (searchSections:false) passes the suite. This is the suite ginko-cms will adopt (§9).

---

## 9. Cross-repo coordination (ginko-cms) — DO NOT execute from this repo

Phase 3+5 are breaking for ginko-cms. Record here; a separate ginko-cms task list executes them **after** this repo tags `0.2.0`:

1. `packages/cms/src/nuxt-provider.mjs` must implement `ContentProviderQuery` (plan-based) and the new envelope; recommended: rewrite in TS importing `ContentProvider` (review CMS-7 already requires this).
2. `packages/cms/src/module/content-contract.ts` consumes `buildCmsContract` — must pass explicit `cms.type` for tree collections (T5.4 removed the `docs` heuristic) and adopt the `editor` passthrough for layout fields.
3. ginko-cms CI adds `runProviderContractSuite` (from T5.6) against the packed provider.
4. Studio's `slugifyUrlSegment` import moves from `/config` to `/cms-contract` (one line, `studio-app/src/lib/slug.ts:1`).
5. Peer range bumps to `^0.2.0`; both `compatibility.json` files regenerate (T7.2 defines the generator).

---

## 10. Phase 6 — Test rebalance

### T6.1 Delete implementation-mirror tests
- Delete/rewrite per review: the exports-list-mirror half of `test/contracts/package-exports-contracts.test.ts` (keep dist import smokes + the new symbol enumeration from T5.1); the resolver-string/mock-shape assertions in `test/contracts/module-contracts.test.ts` (keep its behavioral cases); `test/unit/generated-artifact-helpers.test.ts` (fold into consumers); move `test/unit/docs-drift.test.ts`'s linter into a script (`scripts/docs-drift.mjs`) run by CI + `release:verify`, delete its self-tests (~lines 470-503).
- **Accept:** total suite still catches: a removed export (mutate one, watch red), a docs-drift (mutate one doc, watch script red).

### T6.2 Add the five missing behavior suites (the real protection)
1. **Operator matrix** (`test/unit/query-operators.test.ts`): fixed 12-doc dataset; every `CompareOperator` (`eq ne gt gte lt lte in contains containsAny icontains exists type regex prefix`) × hit/miss/edge (null field, array field, numeric-vs-string). Execute through `executeQueryPlan`, not internals.
2. **Sort stability** (`test/unit/query-sort.test.ts`): equal primary keys keep input order; multi-clause tiebreaks; `numeric`/`caseFirst`/`sensitivity` honored.
3. **Locale fallback, unmocked** (`test/unit/locale-fallback.test.ts`): 3-locale chain (`de-AT → de → en`), missing-intermediate, `_variantPaths`/variant resolution — build a real graph via `buildContentGraph`, do NOT mock `resolveLocaleChain` (the existing query-contracts mock at ~line 83 stays for its own purpose).
4. **Snapshot completeness + identity** (`test/unit/snapshot.test.ts`): T2.2's assertion (missing doc fails build-writer); process-loader single-flight (two concurrent `getProcessGraph` calls → same object); integrity mismatch → rebuild.
5. **Invalidation wiring** (`test/runtime/cache-invalidate.test.ts`): mutate → computed tags/paths flow into `adapter.invalidate` end-to-end with a recording adapter.
- **Accept:** each suite fails when its behavior is deliberately broken (spot-prove for #1 and #4).

### T6.3 Promote a slim e2e smoke to PR CI
- The browser-e2e/search/sitemap suites run only on main-gated `release-verify` (`.github/workflows/ci.yml:38-40`). Add a `<3 min` PR job: build `playground/ginko-basic`, assert `/`, one nested route, and the search index respond 200 with expected content.
- **Accept:** job green in CI config lint (`act` if available, else careful YAML review); full suite unchanged on main.

---

## 11. Phase 7 — Release hardening

### T7.1 Version + changelog for the cutover
- Set version `0.2.0`. Write the CHANGELOG section enumerating every breaking change from Phases 2–5 (envelope rename map, provider wire v1, removed subpaths `./toc` + `./cms-exchange`, removed root type exports, conformance-suite renames, config `editor` passthrough). This section is the migration guide for ginko-cms — be exhaustive; copy the rename table from CS-6.
- **Accept:** preflight (T1.4) passes; a reviewer can migrate a provider using only the CHANGELOG.

### T7.2 Generate `compatibility.json` instead of hand-editing
- Add `scripts/generate-compatibility.mjs` that writes `packages/content/compatibility.json` from package.json versions (+ a pinned-tools map kept in one place); wire into `release:verify` as a `--check` (fails when the committed file drifts).
- **Accept:** `--check` fails when the file is hand-edited to a wrong version.

### T7.3 pagefind → optional peer; ship a working headers cache adapter (GC-11/12b)
- Move `pagefind` from dependencies to `peerDependencies` + `peerDependenciesMeta.optional: true`; at module setup, when `search.engine === 'pagefind'` and the import fails, throw a one-line actionable error ("install pagefind: pnpm add -D pagefind").
- In `src/runtime/server/cache-adapters.ts`: add `headersContentCache()` whose `apply` calls the existing `contentCacheHeaders()` (line ~46); document that the two existing adapters are intentionally inert and when to choose which.
- **Accept:** playground without pagefind installed builds when search engine ≠ pagefind and errors clearly when = pagefind; a runtime test asserts the headers adapter sets `Cache-Control`/`ETag` from a hint.

---
## 12. Cornerstone implementations (CS-1 … CS-7)

> These are the sections most likely to be implemented wrong. Use them as the starting point. Adapt import paths and minor naming to the real code; **do not change the stated invariants**. Signatures below were written against the actual code (`buildContentGraph` in `src/core/content/graph.ts`, `memoizeRuntimeValue` in `src/integrations/nitro/context.ts`, `ContentQueryPlan` in `src/core/query/plan.ts`, `ContentProvider` in `src/public/provider.ts`).

### CS-1 — Snapshot types + builder (`src/core/content/snapshot.ts`)

Invariants: JSON-pure (the #1 way to ship a corrupt snapshot is a `Date` or `undefined` in frontmatter surviving into the artifact — the builder must prove round-trip fidelity at build time, where failing is cheap); versioned; carries both variant ids and source ids (completeness is asserted on **source** ids, because one source file can produce multiple locale variants).

```ts
import type { ParsedContent } from '../../types/content'

export const CONTENT_SNAPSHOT_VERSION = 1 as const

export interface ContentSnapshot {
  version: typeof CONTENT_SNAPSHOT_VERSION
  /** Must equal the runtime config's cache integrity — mismatch means a stale artifact. */
  integrity: string
  generatedAt: number
  /** Fully-qualified, locale-suffixed ids. One per stored variant. */
  documentIds: string[]
  /** Source ids (pre locale-variant split). The completeness assertion runs on these. */
  documentSourceIds: string[]
  documents: ParsedContent[]
}

export interface BuildContentSnapshotArgs {
  integrity: string
  documents: ParsedContent[]
  sourceIds: string[]
  now: number
}

/** Build error carrying every offending path — never fail on just the first one. */
export class ContentSnapshotError extends Error {}

export const buildContentSnapshot = (args: BuildContentSnapshotArgs): ContentSnapshot => {
  // JSON round-trip proof. Cheap at build time; prevents Date/undefined/Map values
  // in frontmatter from becoming silent corruption at runtime.
  const lossy: string[] = []
  const documents = args.documents.map((doc) => {
    const roundTripped = JSON.parse(JSON.stringify(doc)) as ParsedContent
    if (!deepEqualJson(doc, roundTripped)) {
      lossy.push(documentIdOf(doc)) // post-Phase-3: doc.id; pre-Phase-3: doc._id
    }
    return roundTripped
  })
  if (lossy.length > 0) {
    throw new ContentSnapshotError(
      `[content] snapshot: ${lossy.length} document(s) contain non-JSON values (Date, undefined, Map, …): ${lossy.slice(0, 10).join(', ')}`
    )
  }
  return {
    version: CONTENT_SNAPSHOT_VERSION,
    integrity: args.integrity,
    generatedAt: args.now,
    documentIds: documents.map(documentIdOf),
    documentSourceIds: [...new Set(args.sourceIds)].sort(),
    documents
  }
}

export const isContentSnapshot = (value: unknown): value is ContentSnapshot => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.version === CONTENT_SNAPSHOT_VERSION
    && typeof v.integrity === 'string'
    && Array.isArray(v.documents)
    && Array.isArray(v.documentSourceIds)
}
```

`deepEqualJson`: use an existing util if the repo has one (check `src/utils/`); otherwise compare `JSON.stringify` of key-sorted structures — do **not** pull in a new dependency. **Trap:** `JSON.stringify(doc) === JSON.stringify(roundTripped)` is always true by construction — you must compare the *original* against the round-trip with a real deep-equal that distinguishes `Date` from string, or simpler: walk the original and reject any value whose type is not `null | boolean | number | string | plain object | array`. The walker is the more junior-proof option — prefer it.

### CS-2 — Snapshot writer = the repurposed cache route (`src/runtime/server/api/cache.ts`)

Why here: loading documents requires an `H3Event` (every loader takes `event`), and this route is already registered (`src/module/server-handlers.ts:49-51`) and prerendered exactly once per build with the integrity in its URL. We change what it *writes*, not how it runs.

```ts
export default defineEventHandler(async (event) => {
  const now = Date.now()
  const config = contentConfig()

  // 1. Enumerate ALL source ids from the SOURCE driver (not from any cache).
  const sourceIds = await getSourceContentIds(event)   // the source-side enumeration used today by getContentsIds' fallback

  // 2. Load every document through the existing loader (parses + caches as today).
  const documents: ParsedContent[] = []
  for (const chunk of chunksFromArray(sourceIds, 10)) {
    const results = await Promise.all(chunk.map(id => loadContentVariants(event, id)))
    documents.push(...results.flat().filter(isRealDocument)) // exclude missing-doc stubs
  }

  // 3. Build + completeness (CS-4) — throws on any gap, failing the prerender.
  const snapshot = buildContentSnapshot({ integrity: config.cacheIntegrity, documents, sourceIds, now })
  assertSnapshotComplete(snapshot, sourceIds)

  // 4. Persist into the parsed-cache storage mount that ships with the server bundle.
  await cacheStorage(event).setItem('snapshot.json', snapshot)

  // 5. Keep the _nav.json warm-up while it still has readers (T2.4 decides).
  ...existing navigation warm-up...

  return { generatedAt: now, documentCount: snapshot.documentIds.length }
})
```

**Traps:** (a) `isRealDocument` must exclude the `body: null` missing stubs and ignored files, but *ignored* files must also be excluded from the `sourceIds` you assert against — use the same ignore predicate (`contentIgnorePredicate`) on both sides or the assertion will false-positive. (b) Do not reuse `getContentsIds` for step 1 if it prefers cache keys in prod — you need the **source** enumeration path explicitly. (c) The storage item may be large; it's still one `setItem` — do not chunk it in v1.

### CS-3 — Process-scope loader (`src/storage/snapshot-runtime.ts`)

Invariants: single-flight (concurrent first requests share one load), failure resets state (a failed load must not poison the process), integrity mismatch is a hard error (stale artifact ⇒ crash loudly, never serve wrong content).

```ts
import type { H3Event } from 'h3'
import type { ContentGraph } from '../core/content/graph'
import { buildContentGraph } from '../core/content/graph'
import { isContentSnapshot } from '../core/content/snapshot'
import { contentConfig } from './driver'

let state: { integrity: string, promise: Promise<ContentGraph> } | null = null

export const getProcessGraph = (event: H3Event): Promise<ContentGraph> => {
  const config = contentConfig()
  const integrity = config.cacheIntegrity
  if (state && state.integrity === integrity) {
    return state.promise
  }
  const promise = loadGraph(event, integrity)
  // Failure reset WITHOUT swallowing the rejection: attach a passive observer,
  // do not chain the stored promise through .catch (that would hide errors
  // from callers) and do not leave a rejected promise cached (that would
  // brick the process after one transient storage error).
  promise.catch(() => {
    if (state && state.promise === promise) state = null
  })
  state = { integrity, promise }
  return promise
}

const loadGraph = async (event: H3Event, integrity: string): Promise<ContentGraph> => {
  const raw = await cacheStorage(event).getItem('snapshot.json')
  if (!isContentSnapshot(raw)) {
    throw new Error('[content] production snapshot missing or invalid — the site was built without a content snapshot. Rebuild with this package version.')
  }
  if (raw.integrity !== integrity) {
    throw new Error(`[content] snapshot integrity mismatch (built: ${raw.integrity}, runtime: ${integrity}) — stale build artifact.`)
  }
  const config = contentConfig()
  return buildContentGraph(raw.documents, {
    locales: config.locales,
    defaultLocale: config.defaultLocale
  })
}
```

**Traps:** (a) verify the real config field name — `contents.ts` hashes `runtime.config.cacheIntegrity`; use exactly what production populates. (b) `cacheStorage(event)` needs an event — that's fine, the *storage handle* is what needs it; the memoized value is process-global. (c) In `src/storage/graph.ts`, the fork is: `if (isProduction && !isPrerendering) return getProcessGraph(event)` — prerender must keep the request-scoped path. (d) Expose `getProcessDocuments(event)` (from `state`'s snapshot or `graph.documents`) for `getContentsList`'s prod path so nothing re-reads storage.

### CS-4 — Completeness assertion

```ts
export const assertSnapshotComplete = (snapshot: ContentSnapshot, sourceIds: string[]): void => {
  const have = new Set(snapshot.documentSourceIds)
  const missing = [...new Set(sourceIds)].filter(id => !have.has(id))
  if (missing.length > 0) {
    throw new ContentSnapshotError(
      `[content] snapshot incomplete: ${missing.length} source document(s) missing `
      + `(first ${Math.min(missing.length, 20)}): ${missing.slice(0, 20).join(', ')}. `
      + `This build would silently 404 these pages in production.`
    )
  }
}
```

Direction matters: assert `sourceIds ⊆ snapshot` (missing pages fail the build). The reverse (`snapshot ⊆ sourceIds`) is a warning at most.

### CS-5 — Provider wire contract v1 (`src/public/provider-query.ts`)

Invariants: closed (no index signatures), versioned, JSON-pure, and expressed in the existing plan AST — providers pattern-match `FilterExpr`, they never parse builder params again.

```ts
import type { ContentQueryPlan } from '../core/query/plan'

export const PROVIDER_QUERY_VERSION = 1 as const

/**
 * The single wire type crossing the provider boundary.
 * JSON-pure by contract: no RegExp instances, no Dates, no functions.
 */
export interface ContentProviderQuery {
  v: typeof PROVIDER_QUERY_VERSION
  /** null = cross-collection query (navigation/search aggregation paths). */
  collection: string | null
  plan: ContentQueryPlan
}
```

Then in `src/public/provider.ts`:

```ts
query: <T = ParsedContent>(event: H3Event, query: ContentProviderQuery) => Promise<MaybeContentProviderResult<ContentQueryResponse<T>>>
```

**Traps — read carefully:**
1. **`regex` operator serialization.** If any lowering path can put a `RegExp` instance into `FilterExpr.value`, the wire is not JSON-pure. Grep first: `git grep -n "regex" src/core/query src/runtime/query`. If RegExp instances occur, change the compare node for `regex` to carry `{ source: string, flags: string }` and update the executor to reconstruct. Add a dev-mode assertion in the provider registry that `JSON.parse(JSON.stringify(query))` deep-equals `query`.
2. **Fields the old params carried that the plan may not:** before coding, list every property of `ContentQueryBuilderParams` actually **read** by `src/runtime/server/providers/index.ts` and the filesystem provider (`resolveLocale`, `canonical`, `navigationFields`, `first`, `only`, `without`, …). `first/only/without` map to plan `mode`/`projection`. `resolveLocale`/locale envelope maps to the plan's locale-resolution block (it exists — see `plan.ts` after line 66). `navigationFields` does **not** belong in the plan: it configures `navigationQuery`, so give navigation its own small options type (`ContentProviderNavigationOptions { fields?: string[], locale?: … }`) instead of smuggling it through the query. Anything left over that no code reads: delete, don't port.
3. **Capability validation** now derives the operator list by walking the `FilterExpr` tree (collect `compare` nodes' operators recursively including `and/or/not`) — write that walker once in the registry, with a unit test.

### CS-6 — Envelope rename map (Phase 3)

Mechanical map — apply to types first, then chase the compiler. `ParsedContent` should end up named `ContentDocument` (keep a `type ParsedContent = ContentDocument` alias **only inside the package** for the duration of Phase 3, delete it in T3.3 — it never ships in 0.2.0).

| Old (delete) | New | Notes |
|---|---|---|
| `_id` | `id` | Required. Fully-qualified, locale-suffixed id. |
| `_path` | — (already `path`) | Verify semantics identical before deleting; if `_path` and `path` ever diverge in a code path, STOP and record it. |
| `_collection` | `collection` | |
| `_locale` | — (already `locale`) | |
| `_type` | `type` | Document kind (`markdown`/`yaml`/…). |
| `_extension` | `extension` | |
| `_source` (if present) | `source` | Check existence via grep. |
| `_canonicalKey` | **internal meta only** | Move to the internal-meta type; strip from provider-facing and public result shapes. Public code resolves via graph indexes, per ADR-0006. |
| `{ _id, body: null }` stub | `MissingDocument` | `interface MissingDocument { id: string, body: null, missing: true }`; loaders return `ContentDocument \| MissingDocument`; filters use `isRealDocument` type guard. |
| any other `_`-prefixed **meta** field | camel-case equivalent | Enumerate first: `git grep -hoE '"?_[a-z][A-Za-z]+"?\s*[:?]' src/types/ \| sort -u`. |

**The trap:** user frontmatter is passthrough data — a user file may legitimately contain `_draft: true` or any underscore key in its frontmatter. The rename applies to **system meta fields declared in our types**, never to dynamic frontmatter handling. Do not write a generic "strip leading underscore" transform anywhere.

### CS-7 — i18n type holes (Phase 5, T5.5)

Fix 1 — `TreeOptions` composes the locale obligation (`src/types/query-parts/public.ts:244-253`):

```ts
export type TreeOptions<H extends ContentCollectionHandleLike> = {
  // ...existing option fields, WITHOUT the bare `locale?: string` line...
} & LocaleOption<H>   // same mechanism One/Many/Variants/Neighbors already use (public.ts:92-94)
```

Fix 2 — the zero-argument hole. `many(docs)` currently compiles for i18n handles because of `options: O = {} as O` (`src/runtime/query/unified.ts:98`, mirrored in `src/runtime/server/query-api.ts`). The defaulted parameter defeats the `LocaleOption` requirement. Replace the parameter list with a conditional variadic tuple — this is the piece a junior implementation will get wrong; use exactly this shape:

```ts
type OptionsArg<H, O> = HandleIsI18n<H> extends true
  ? [options: O]          // i18n: options object is REQUIRED (its type already requires `locale`)
  : [options?: O]         // non-i18n: stays optional

export function many<H extends Handle, O extends ManyOptions<H> = ManyOptions<H>>(
  handle: H,
  ...args: OptionsArg<H, O>
): ManyResult<H, O> {
  const options = (args[0] ?? {}) as O
  // ...existing body unchanged...
}
```

Apply the same pattern to `tree` and to any other verb whose options parameter is defaulted. Mirror in **both** the client (`runtime/query/unified.ts`) and server (`runtime/server/query-api.ts`) implementations — they must stay signature-identical.

Negative type tests to add in `test/fixtures/typecheck/types/ginko-api.ts` (alongside the existing 25):

```ts
// @ts-expect-error — i18n collections require a locale; zero-arg many() must not compile
many(i18nDocs)
// @ts-expect-error — tree options on i18n collections require `locale`
tree(i18nDocs, {})
// Control (must compile): zero-arg many on a non-i18n handle
many(plainDocs)
```

If ADR-0016's tree-fallback-by-default turns out to be intentional (docstring at `unified.ts:169-172` hints it may be), do Fix 1 anyway and record the decision — then amend ADR-0016's "no hole" claim instead of shipping a false ADR.

---

## 13. Definition of done + senior review checkpoints

The refactor is done when **all** of:

1. Status Log fully checked; global gate + full `release:verify` (minus publish) green.
2. `git grep -nE '\b_(id|path|collection|locale|canonicalKey|type|extension)\b' src/` → empty (modulo the documented internal-meta file).
3. `git grep -n "ContentQueryBuilderParams\|cms-exchange\|runSaasProviderFixture" src/ test/ docs/` → empty.
4. Production playground request path: one snapshot load + one graph build per process (proven by T6.2 test #4).
5. A build with a deliberately skipped document **fails** (T2.2 / T6.2 test #4).
6. package.json version `0.2.0`, CHANGELOG migration guide complete (T7.1), preflight passes.
7. §9 cross-repo list handed over — ginko-cms updated **separately** before any publish of either package.

**Senior reviewer checkpoints** (review before the agent proceeds):
- After Phase 2: read `snapshot.ts`, the rewritten cache route, `snapshot-runtime.ts`, and the `storage/graph.ts` fork end-to-end. Highest-risk questions: is prerender still on the request-scoped path? Is the failure-reset single-flight correct? Is the ignore predicate applied symmetrically in CS-2?
- After Phase 3: sample 5 of the ~20 renamed files; verify `canonicalKey` is genuinely internal; verify the provider registry's JSON-purity assertion exists; run the ginko-cms test suite against the linked workspace **expecting it to break** — the break list must match §9.
- After Phase 5: diff `meta/public-surface.json` against 0.1.7's version and confirm every removal is intentional and in the CHANGELOG.
- Anything in the Status Log "Deviations" section — resolve each explicitly.
