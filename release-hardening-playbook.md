# Ginko Content — 0.2.0 Hardening Playbook for Autonomous Execution

> **This file is an executable spec.** It is written so an AI agent (or a
> developer) can complete the 0.2.0 release hardening end-to-end without
> asking a human anything. Every decision that needed a ruling has one (§3).
> Every task has explicit acceptance criteria and a gate. Work top-to-bottom.
>
> Strategy/verification background lives in `release-hardening-todo.md`
> (§0 there records which review findings were confirmed vs. hallucinated —
> read it if you need the "why", not to execute).
> Process conventions inherit from `refactor-todo.md` (§3 verification
> protocol, §2 status-log discipline).

---

## 0. Agent kickoff prompt (copy-paste to start the agent)

You are hardening the `refactor-fable` branch of `ginko-content` for the
0.2.0 release. Open `release-hardening-playbook.md` and execute it phase by
phase, top to bottom. Non-negotiables:

1. Follow §2 (rules) exactly. Run the phase gate after every task.
2. Do not ask the user questions — §3 contains a pre-made ruling for every
   judgment call. If you hit a decision §3 does not cover, choose the
   smallest reversible option, record it in §14 (Status Log), and continue.
3. Every behavioral fix lands with a regression test proven in BOTH
   directions: check out / stash the fix, watch the test fail; restore the
   fix, watch it pass. Record the proof in the Status Log entry.
4. Append to §14 after every task: what changed, gate results, deviations.
5. Never push, never publish, never create tags. Local commits only.

Start with Phase 0 (§4): the working tree contains ~34 modified,
UNCOMMITTED files from a prior fix pass. Your first job is to verify and
commit that work — not to redo it.

---

## 1. Mission and context

**Repo:** `/…/ginko-content`, branch `refactor-fable`. Last commit `aea85be`.
**Sibling repo:** `/…/ginko-cms` (do NOT modify it; Phase 6 only edits
*this* repo's handover docs about it).

**What happened:** the v0.1.7→v0.2.0 refactor was adversarially reviewed by
three independent reviewers; findings were cross-verified (see
`release-hardening-todo.md` §0). A prior session then fixed roughly half the
findings directly in the working tree and stopped **without committing**.

**Current uncommitted state (verified 2026-07-08 ~16:30):**

Already FIXED in the working tree (Phase 0 verifies + commits these):
- Wire lowering rewritten (`core/query/lower.ts`): tagged
  `{ type: 'regex', source, flags }` PlanRegex (solves regex/data ambiguity),
  Date→ISO lowering, element-wise array/object operand walking, regex-flags
  whitelist via `assertSupportedRegexFlags`.
- `query.v === PROVIDER_QUERY_VERSION` enforced in
  `runtime/server/providers/index.ts`; `default:` throw cases added to the
  plan walkers there and in `core/query/execute.ts` (lines ~112, ~152).
- Navigation reverse-lowering rewritten (`runtime/server/navigation-query.ts`)
  — `$and` arrays instead of lossy `Object.assign`, plus a `default:` throw.
- `parsers/reserved.ts`: `RESERVED_CONTENT_KEYS` grown to 11 (adds `file`,
  `resolved`, `variants`, `localePaths`, `unprefixedPath`) + new
  `stripReservedContentKeys`, wired into `parsers/{markdown,yaml,json}.ts`.
- `contracts-node` vitest project wired into `test` / `test:coverage` /
  `test:watch` scripts (`package.json`); `test/contracts/vnext-golden-demo.test.ts`
  moved to the v1 wire shape.
- Facade mirror tests for client/server added in
  `test/contracts/package-exports-contracts.test.ts` (lines ~124, ~138).
- `#content/server` runtime barrel + generated declarations extended with the
  wire helpers (`runtime/server/index.ts`, `module/runtime-assets.ts`).
- Example import fixed (`examples/advanced/cms-cache-contract/server/cms-provider.ts`).
- CHANGELOG.md: NavItem-specific migration rows, pagefind-optional-peer
  bullet, stem bugfix disclosure, `filterQuery` default change, reserved-keys
  section, serializer `ctx.page` note, missing-document stub documented as
  `{ id, body: null, missing: true }` **with an explicit "no
  `MissingDocument` type or `isRealDocument()` guard is exported"** (this is
  the accepted resolution — do NOT export the guard, see ruling R-7).
- Docs: `7.search/2.pagefind.md` install step; migration doc
  `8.migration/2.from-nuxt-content-v3.md` field table; skills
  (`skills/ginko-content/…`) de-underscored.

NOT yet fixed (Phases 1–7 below): docs-drift self-test, docs-build smoke,
examples typecheck, `navigationQuery` capability enforcement, `_dir` leak,
`navigationFile` code-comment honesty, deterministic locale order, snapshot
symbol-keys + error paths, value-preservation re-run, `ContentQueryPlan`
export, `useContentSwitchLocalePath` client export, agent-registry dead code,
generated-code quoting, packed-consumer serializer probe, comark plugin
loading, docs-app link bugs, meta-docs/ADR corrections, `refactor-todo.md` §9
amendments, post-tag items, tag re-cut.

---

## 2. Rules of engagement (non-negotiable)

**Commands** (run from repo root):

| Gate | Command | When |
|---|---|---|
| G-fast | `pnpm typecheck && pnpm test` | after every task |
| G-lint | `pnpm lint` | before every commit |
| G-drift | `pnpm docs-drift` | after any docs/skills/script change |
| G-full | `pnpm verify` | end of every phase |
| G-release | `pnpm run release:verify` | once, in §13 only |

Note: `pnpm test` now includes the `contracts-node` project (5 files / 36
tests). If it doesn't on your checkout, Phase 0 was lost — restore it first.

**Discipline:**

1. **Both-directions proof** for every behavioral fix (see §0 item 3).
2. **One task = one commit.** Message format:
   `fix|test|docs|chore(scope): imperative summary [HP-<task-id>]` and end
   with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
3. **Never weaken an existing test to make a gate pass.** If a test
   contradicts a task, the task text wins only when it explicitly says the
   test must change (e.g. HP-C1); otherwise stop and record in §14.
4. **No scope creep.** No new features, no drive-by refactors, no dependency
   bumps. If you notice an unrelated bug: one-line note in §14, move on.
5. **Do not touch** `ginko-cms/` (read-only reference), do not push, do not
   tag, do not publish, do not run `release:publish`.
6. **Line numbers in this file are anchors, not gospel** — the tree moves.
   Locate by the quoted identifier/snippet first, line number second.
7. If a task turns out to be ALREADY DONE when you reach it (the prior
   session may resume), verify its Accept block, mark it done in §14 with
   "pre-existing, verified", and move on. Never redo work.

---

## 3. Rulings (pre-decided — do not re-litigate, do not ask)

| # | Question | Ruling |
|---|---|---|
| R-1 | Dates on the wire | Lower to ISO-8601 strings (already implemented — keep). |
| R-2 | `_dir` on variant-query envelopes | **Rename to `dir`** (public, documented). Not deleted: playgrounds/docs rely on the merged dir-config data. |
| R-3 | `navigationFile` | **Public documented field** (it serializes on every envelope and playgrounds filter on it over the wire). Fix the lying code comment; keep the CHANGELOG wording that already discloses it. |
| R-4 | Agent-markdown registry | Document as **per-process singleton**; DELETE dead `setupAgentMarkdownRegistry`; do NOT build per-app binding (that is G-phase, out of scope). |
| R-5 | Provider wire-version handshake at registration | **Defer to 0.2.x** (Phase 7 note only). The receive-side `v` check (already landed) covers 0.2.0. |
| R-6 | Snapshot `undefined` admission (object props + array slots) | **Keep** — it is deliberate prod-parity policy from commits `aea85be`/`593a32d`. Only add: symbol-key rejection + offending-path error payloads (HP-C6). |
| R-7 | `isRealDocument`/`MissingDocument` export | **Do not export.** The accepted fix (already in CHANGELOG) documents the stub shape and states no guard is exported. Keep internal. |
| R-8 | NavItem `stem` value change | Keep the new (correct) full stems; disclosure already in CHANGELOG. |
| R-9 | Locale order in `variants[]` / `resolved.availableLocales` | Restore deterministic order: **collection default locale first, then collection/global config order** (HP-C4). |
| R-10 | Version string for release | Stay `0.2.0`. Delete the stale local tag and re-cut at the final commit (§13). Nothing was ever pushed/published (npm latest is 0.1.6). |

---

## 4. Phase 0 — Stabilize: verify and commit the inherited working tree

### HP-0.1 Baseline gates over the uncommitted tree
- [ ] Run `git status --short` — expect ~34 modified files matching §1's list
      plus untracked `release-hardening-todo.md` and this file. If the tree is
      CLEAN, a prior agent already committed Phase 0: verify
      `git log --oneline -15` mentions hardening commits, then skip to Phase 1.
- [ ] `pnpm build:packages && pnpm typecheck && pnpm test` — all green
      (expect ≥ 592 tests incl. contracts-node's 36). Then `pnpm lint`.
- [ ] If anything is red: the prior session stopped mid-edit. Diagnose from
      the failure outward; fix forward (do not `git checkout --` wholesale).
      Record every forward-fix in §14.

**Accept:** full G-fast + G-lint green on the uncommitted tree.

### HP-0.2 Spot-verify the five load-bearing inherited fixes
Each ~2 minutes; run as one throwaway vitest file or node REPL against
`packages/content/dist` (rebuild first), then delete the scratch file:
- [ ] `$in: [/^intro/i, 'other']` lowers to a plan whose array entries are
      `{ type: 'regex', source: '^intro', flags: 'i' }` — no live RegExp; the
      plan survives `JSON.parse(JSON.stringify(...))` with equal results.
- [ ] `{ date: { $gt: new Date('2024-01-01') } }` lowers to an ISO string;
      bare `{ date: new Date(...) }` does NOT collapse to match-everything.
- [ ] A provider query with `v: 2` is rejected with a typed error on the
      `query` path. (KNOWN: `navigationQuery` still accepts it — the version
      check sits inside `assertProviderQuerySupported`, which that wrapper
      doesn't call yet; HP-B4 fixes capability + version together. Just
      confirm the `query` path rejects.)
- [ ] A plan with `filter: { type: 'mystery' }` throws (both the capability
      walker and the executor), no silent empty result.
- [ ] Frontmatter `resolved: { locale: 'de' }` + `variants: [1]` +
      `unprefixedPath: '/x'` is stripped at parse time by all three parsers
      (markdown, yaml, json) — parse a tiny fixture through each.

**Accept:** all five behave as described.
**If one fails:** it is NOT done — pull the matching task spec from
`release-hardening-todo.md` (B1/B2/B3/B5/C3) and implement before committing.

### HP-0.3 Commit the inherited work in logical chunks
- [ ] Commit 1 `fix(query): close the provider wire — tagged regex, ISO dates, version check, exhaustive walkers [HP-0]`:
      `core/query/{lower,plan,execute}.ts`, `public/provider-query.ts`,
      `runtime/server/{providers/index,navigation-query,query-executor,index}.ts`,
      `testing/provider-fixture.ts`, `module/runtime-assets.ts`,
      and the matching test files.
- [ ] Commit 2 `fix(parsers): strip reserved localization keys from user frontmatter [HP-0]`:
      `parsers/{reserved,markdown,yaml,json}.ts`, `cli/doctor/i18n.ts` + tests.
- [ ] Commit 3 `test(contracts): wire contracts-node into pnpm test; golden demo on v1 wire; client/server facade mirrors [HP-0]`:
      `package.json`, `test/contracts/*`.
- [ ] Commit 4 `docs: 0.2.0 changelog corrections + migration/skill/pagefind updates [HP-0]`:
      `CHANGELOG.md`, `docs/content/**`, `skills/**`,
      `examples/advanced/cms-cache-contract/server/cms-provider.ts`.
- [ ] Commit 5 `chore: add release-hardening playbooks [HP-0]`:
      `release-hardening-todo.md`, `release-hardening-playbook.md`.
- [ ] After each commit: `git status` must show only the remaining chunks.

**Accept:** clean tree, `pnpm test` green at the new HEAD.
**Gate:** G-full (`pnpm verify`).

---

## 5. Phase 1 — Guardrails that are still missing

### HP-A4 docs-drift self-test (the detectors currently fail open)
**Context:** `scripts/docs-drift.mjs` runs in CI but every detector is a pure
absence check — a regex that rots to matching nothing still exits 0. Its own
header admits the old vitest self-test was dropped. It also polices `_fallback`
(a field name that no longer exists) and has no current-envelope patterns.

**Files:** `scripts/docs-drift.mjs`, new `scripts/docs-drift-fixtures/`.

**Steps:**
1. Create `scripts/docs-drift-fixtures/positive-controls.md` containing one
   deliberate offender per detection pattern (one line each, labeled).
2. In `docs-drift.mjs`, add a `--self-test` mode (and run it automatically at
   the start of a normal run): every pattern in every pattern-list must match
   ≥ 1 line of the fixture file, else print the dead pattern and `exit 1`.
3. Update the pattern lists: keep `_fallback` only as an *old-name* detector;
   add current-drift detectors for `_path`, `_id`, `_file`, `_locale`,
   `_stem`, `_dir`, `_extension` presented as current API in `docs/content`
   and `skills/` (allow-list: explicitly labeled before/after blocks in the
   migration doc — the existing script already has an allow-list mechanism
   for paths; extend it, don't fork it).
4. Add fixture lines for each new pattern.

Cornerstone code: **CS-2** (§12).

**Accept:**
- Neuter any one regex (e.g. change `_path` to `_zzzpath`) → script exits 1
  naming the dead pattern. Restore it.
- Insert `page._path` as current-API prose into any docs page → script exits
  1. Remove it.
- Clean run exits 0.
**Commit:** `test(docs-drift): self-testing detectors + current-envelope patterns [HP-A4]`

### HP-A5 docs-build smoke: no `undefined` in generated hrefs
**Files:** `scripts/` (new `docs-smoke.mjs` or extend an existing script),
`package.json` (`verify` chain).

**Steps:** after `pnpm docs:build`, grep the generated HTML output directory
for `href="[^"]*undefined` and `/undefined"` — exit 1 with the offending
files. Wire into `verify` right after `docs:build`.

**Accept:** temporarily reintroduce the `_file` read in
`docs/app/pages/docs/[...slug].vue` (see HP-E2) → smoke fails; with HP-E2's
fix → passes. (Order note: implement HP-E2 first if the docs build currently
emits `undefined` — check first; the two tasks pair.)
**Commit:** `test(docs): build smoke rejects undefined in generated hrefs [HP-A5]`

### HP-A6 Typecheck the flagship example
**Context:** `examples/advanced/cms-cache-contract` imported a nonexistent
alias for weeks because nothing typechecks it.

**Steps:** add script `typecheck:examples` that runs the example's
`nuxi typecheck` (after its `dev:prepare`); wire into `verify` next to
`examples:build`. If the example has no tsconfig/prepare wiring, add the
minimal standard Nuxt one (match `test/fixtures/*` conventions).

**Accept:** change the example's import back to `#content/provider` → exits
non-zero; restore → green.
**Commit:** `test(examples): typecheck cms-cache-contract in verify [HP-A6]`

**Phase gate:** G-full.

---

## 6. Phase 2 — Remaining wire enforcement

### HP-B4 `navigationQuery` must enforce query capabilities
**Context:** the `query` wrapper calls `assertProviderQuerySupported`; the
`navigationQuery` wrapper (in `packages/content/src/runtime/server/providers/index.ts`,
search for `navigationQuery: provider.navigationQuery`) only checks operation
support + JSON purity + (since Phase 0) version. A provider declaring
`operators: ['$eq']` or `limit: false` still receives unsupported plans on
the navigation path.

**Steps:** add `assertProviderQuerySupported(provider, query)` to the
navigationQuery wrapper, mirroring the `query` wrapper exactly. Cornerstone
**CS-3** (§12) has the target shape + tests.

**Accept (both directions):** new tests in
`test/contracts/provider-contracts.test.ts`:
1. provider with `operators: ['$eq']` + navigation query containing
   `$contains` → typed `unsupported_query_operator` rejection, provider not
   called;
2. provider with `limit: false` + navigation query with `limit: 1` → typed
   rejection;
3. navigation query with `v: 2` → typed rejection (the version check rides
   in with `assertProviderQuerySupported`);
4. supported plan → provider called once (no regression).
**Commit:** `fix(providers): navigationQuery enforces declared query capabilities [HP-B4]`

**Phase gate:** G-fast + `pnpm vitest run --config vitest.config.ts --project provider --project contracts-node`.

---

## 7. Phase 3 — Envelope integrity

### HP-C1 Rename `_dir` → `dir` (ruling R-2)
**Context:** `core/query/execute.ts` (`withDirConfig`, search for `_dir:`)
still attaches an underscore field to variant-query results;
`test/contracts/query-contracts.test.ts` (~line 260) asserts the leak; the
CHANGELOG claims underscore metadata is gone.

**Steps:**
1. In `withDirConfig`, emit `dir` instead of `_dir` (keep the
   `{ ...dirConfig, ...dirConfig.body }` merge).
2. Repo-wide search `git grep -nP '\b_dir\b' packages docs skills playground test`
   — update every consumer (test assertion included; the fixture file id
   `content:en:_dir.yml` is a filename, leave it).
3. CHANGELOG: add row `_dir` → `dir` ("directory `.navigation.yml` config
   merged onto route-variant results") in the envelope table.
4. Add the blanket guard this leak proves we need — in
   `test/contracts/query-contracts.test.ts`, a test that walks a
   representative full query + variant + navigation response and asserts **no
   top-level key starts with `_`**.

**Accept:** blanket test fails on old code (checkout `execute.ts` from HEAD~1
to prove), passes on new; grep from step 2 returns only historical
CHANGELOG/status-log lines.
**Commit:** `fix(query)!: rename variant-result _dir to dir; forbid underscore keys on public envelopes [HP-C1]`

### HP-C2 `navigationFile` code honesty (ruling R-3)
**Files:** `packages/content/src/types/content.ts` (search `Never a public
field`), `meta/public-surface.json` if it catalogs envelope fields (check;
likely not — it catalogs exports).

**Steps:** rewrite the comment: public, always-present boolean marking
folder-scoped `.navigation.yml` config documents; filterable over the wire
(`navigationFile: { $ne: true }`). Verify CHANGELOG already discloses it
(Phase 0 landed wording "remains present on provider/search filtering paths");
strengthen to a proper envelope-table row if it is not already one.

**Accept:** `git grep -n "Never a public field" packages` → 0 hits.
**Commit:** `docs(types): navigationFile is public and documented as such [HP-C2]`

### HP-C4 Deterministic locale order (ruling R-9)
**Context:** `variants[]` and `resolved.availableLocales` flipped from
`["en","de"]` (0.1.7) to `["de","en"]` (HEAD) because order now comes from
graph insertion. Language switchers render this order.

**Investigate first** (30 min cap): find where variants arrays are assembled —
start `packages/content/src/core/content/graph.ts` (byCanonical variant maps),
`core/query/execute.ts` (search `variants`), 
`features/localization/results.ts` (search `availableLocales`). The fix
belongs at the ASSEMBLY sites (sort once when building the array), not in
every consumer.

**Steps:** order = collection i18n `defaultLocale` first, then remaining
locales in collection-config order (fall back to global `content.locales`
order). Implement as one exported helper
(`sortLocalesCanonically(locales, config)`) used by every assembly site.

**Accept (both directions):** unit test with a two-locale collection
(`defaultLocale: 'en'`, docs inserted de-first) asserting
`variants.map(v => v.locale)` = `['en','de']` and
`resolved.availableLocales` = `['en','de']`; fails before, passes after.
Also: `playground/ginko-i18n` build (`pnpm --filter ginko-i18n... generate`
or the e2e project that covers it) still green.
**Commit:** `fix(i18n): deterministic locale order from collection config [HP-C4]`

### HP-C6 Snapshot walker: symbol keys + offending paths (ruling R-6)
**Files:** `packages/content/src/core/content/snapshot.ts`.

**Steps:**
1. In the object branch of `findNonJsonValue` (search `Object.entries` /
   `for (const [key`), first check
   `Object.getOwnPropertySymbols(value).length > 0` → return the current
   path as lossy (symbol-keyed enumerable props are silently dropped by
   JSON today).
2. Error payload: the aggregation currently does `lossy.push(documentIdOf(document))`
   — change `lossy` entries to `{ id, paths: string[] }` where `paths` are
   the walker's computed offending paths, and include them in the
   `ContentSnapshotError` message (`id (field.path[2])`). Keep the
   "aggregate all, never fail on first" behavior.
3. Do NOT change `undefined` admission (R-6).

Cornerstone **CS-5** (§12).

**Accept (both directions):** two new tests in the snapshot suite:
symbol-keyed doc → build throws naming the doc id and path; multi-offender
doc → error message contains BOTH offending paths. Existing
`undefined`-admission tests stay green untouched.
**Commit:** `fix(snapshot): reject symbol-keyed fields; error carries offending paths [HP-C6]`

### HP-C7 Value-preservation re-run (release gate, do LAST in this phase)
**Context:** HP-C1/C4 change payload bytes; the release claim is "values
preserved modulo the disclosed delta list".

**Steps:** cornerstone **CS-6** (§12) — build `playground/ginko-i18n` at
`v0.1.7` (clean worktree) and at your HEAD, decode all `_payload.json`,
apply the rename map, normalize volatile keys, diff.

**Accept:** the ONLY remaining diffs are the disclosed set: envelope renames
(map applied), `stem` full values, `navigationFile` presence, `dir` rename,
locale-order (now matching 0.1.7 again per HP-C4 — so ideally ZERO order
diffs), `resolved.locale` `undefined`→`''` encoding, dropped dead `contents:[]`.
Any OTHER value diff = STOP, record in §14, fix before proceeding.
**Commit:** none (verification only) — paste the diff summary into §14.

**Phase gate:** G-full.

---

## 8. Phase 4 — Public surface, generated code, dead code

### HP-D5 Export `ContentQueryPlan` from `./provider`
**Files:** `packages/content/src/public/provider-query.ts` (it already
imports the type), `meta/public-surface.json` (add to the provider bucket —
create the bucket if the file has none; keep JSON sorted), the facade mirror
test will enforce automatically if it covers `./provider`; if it does not,
extend it while you are there.

**Accept:** `import type { ContentQueryPlan } from '@lupinum/ginko-content/provider'`
typechecks in a scratch file inside the packed-consumer or quickstart
fixture; mirror test green.
**Commit:** `fix(public): export ContentQueryPlan from ./provider [HP-D5]`

### HP-D6 Export `useContentSwitchLocalePath` from `./client`
**Context:** auto-imported (see `module/runtime-assets.ts` composables list)
and documented, but absent from `public/client.ts` — explicit-import users
(`import { … } from '@lupinum/ginko-content/client'`) get a build error.

**Steps:** re-export from `public/client.ts` (mirror how the sibling
composables are re-exported there); add to `public-surface.json`
`clientValueExports`; the HP-A3 mirror test (already landed) enforces the
pairing.

**Accept:** mirror test green; `pnpm test` green.
**Commit:** `fix(public): useContentSwitchLocalePath exported from ./client [HP-D6]`

### HP-D7 Agent registry: delete dead setup, document the singleton (R-4)
**Files:** `packages/content/src/runtime/server/agent-markdown.ts`
(`setupAgentMarkdownRegistry`, module-level `appRegistry`),
`test/unit/agent-markdown-registry.test.ts`, `meta/public-surface.json` +
CHANGELOG if the symbol is public (check the agent facade — grep
`setupAgentMarkdownRegistry` in `public/`).

**Steps:**
1. Delete `setupAgentMarkdownRegistry` and its false "called on module
   setup" doc comment.
2. Rewrite the module doc comment on the registry: per-process singleton;
   serializers registered via `registerAgentMarkdownSerializer` from Nitro
   plugins; last registration for a name wins; no per-app isolation.
3. Fix the registry unit test: it currently simulates a lifecycle hook the
   runtime never fires — test the real contract instead (register → render
   → override → render).
4. If the symbol was in any public facade or `public-surface.json`, remove +
   one CHANGELOG line under 0.2.0 ("removed unused `setupAgentMarkdownRegistry`,
   never wired").

**Accept:** `git grep -n setupAgentMarkdownRegistry` → 0 hits outside
CHANGELOG/status logs; agent-markdown tests green.
**Commit:** `chore(agent): remove dead registry setup; document per-process singleton [HP-D7]`

### HP-D9 Generated-code quoting
**Files:** `packages/content/src/module/content-components-template.ts`
(search `` `  ${pascalName}: () => import(`` — the KEY is unquoted while
`nameLiteral` two lines up is quoted), `packages/content/src/module/runtime-assets.ts`
(search `import('${resolveRuntimeModuleRoot` — raw path interpolation;
`JSON.stringify` is used correctly ~2 lines later for other values).

**Steps:** use `nameLiteral` (already computed) as the object key; wrap the
interpolated module path in `JSON.stringify(...)` (note: the surrounding
template already supplies quotes — replace `'${expr}'` with `${JSON.stringify(expr)}`,
do not double-quote).

**Accept (both directions):** new test in
`test/contracts/module-contracts.test.ts` (or the components-template test if
one exists — search `content-components-template` in test/): feed a component
named `3dViewer` (from `3d-viewer.vue`) through the template generator and
`new Function(code)` the output — throws before the fix, parses after.
**Commit:** `fix(module): quote generated identifiers and paths [HP-D9]`

### HP-D10 Packed-consumer serializer probe (settles the last UNVERIFIED risk)
**Context:** nobody has proven that a serializer registered from the
*installed npm package* reaches the same registry instance as the inlined
runtime (`dist/runtime` inlined vs `dist/public/agent` externalized — dual
module instance risk).

**Files:** `scripts/test-packed-consumer.mjs` and the fixture app it builds.

**Steps:** in the packed-consumer fixture, add
`server/plugins/register-serializer.ts` that imports
`registerAgentMarkdownSerializer` from `@lupinum/ginko-content/agent` (the
packed package) and registers a serializer emitting a sentinel tag for some
node type; assert the sentinel appears in an agent-markdown response.

**Accept:** probe passes → risk retired, note in §14. Probe FAILS → you found
the dual-instance bug: fix by making the runtime import the registry from the
same public module (one canonical module instance), then probe passes.
Either outcome is a success for this task; record which one happened.
**Commit:** `test(pack): serializer registration from installed package [HP-D10]`

### HP-D11 comark plugin loading (pre-existing bug, same class as fixed transformers)
**Files:** `packages/content/src/parsers/markdown-plugins.ts` (search
`@vite-ignore` — dynamic `import(specifier)` for `breaks`/`emoji`/
`json-render`/`math`/`mermaid`/`punctuation`/`security` while comark is
forced `noExternal`; note `toc`/`footnotes`/`highlight` in the same table
were already converted to static imports — copy that pattern),
`packages/content/src/runtime/markdown/plugins.ts` (search `.join('/')` —
client-side bare specifiers for math/mermaid; make them literal
`import('@comark/vue/plugins/math')` so the bundler can resolve them),
`packages/content/src/runtime/app/plugins/markdown-components.ts` (registered
nowhere — delete it; `git grep markdown-components packages` must come back
empty afterwards).

**Accept (both directions):** extend the packed-consumer fixture (or a
playground e2e) with `breaks: true` + math content: server render includes
the plugin's output after the fix; before the fix the plugin silently no-ops
in the packed build. Client: production build contains no bare
`@comark/vue/plugins` runtime specifier that the browser would have to
resolve (grep the build output).
**Commit:** `fix(markdown): bundler-resolvable comark plugin imports; drop dead client plugin [HP-D11]`

**Phase gate:** G-full + `pnpm test:package-consumer`.

---

## 9. Phase 5 — Docs that are still wrong

### HP-E2 Docs app link bugs (real UX bugs, not prose)
**File:** `docs/app/pages/docs/[...slug].vue`.
1. Edit link (search `toc.bottom.edit`): currently interpolates deleted
   `(page as any)?._file` → renders `…/docs/content/undefined`. Use
   `page.file?.path` (guard: hide the link when absent).
2. Surround links (search `_path:`): the code writes the `/docs`-prefixed
   path into dead `_path` while Nuxt UI's `ContentSurround` reads
   `link.path` — prev/next currently navigate to UNPREFIXED routes. Write
   the prefixed value to `path` and drop `_path` from the type + spread.

**Accept:** `pnpm docs:build` + HP-A5 smoke green; grep the built HTML for
`edit/main/docs/content/undefined` → 0 hits; spot-open one built doc page's
HTML and confirm prev/next hrefs start with `/docs/`.
**Commit:** `fix(docs-app): edit + surround links use the new envelope [HP-E2]`

### HP-E6 Meta docs + ADR corrections
- [ ] `meta/ARCHITECTURE.md` (search `_navigation.yml`) and
      `meta/ABSTRACTIONS.md` (same — note line ~132 already says the correct
      `.navigation.yml`; fix line ~30): the convention is `.navigation.yml`.
- [ ] `meta/adr/0018-public-surface-classification.md`: the "Alternatives
      considered — rejected" paragraph about agent/cache subpaths is now
      false (package.json ships `./agent`). Append a dated "Superseded on
      this point" note (ADRs are immutable records — annotate, don't rewrite
      history).
- [ ] Skill residue: `skills/ginko-content/references/search-sitemap.md`
      (search `r._locale`) — drop the dead `||r._locale` fallback.

**Accept:** G-drift green (with HP-A4's new detectors — which must NOT flag
the ADR's annotated historical text; extend the allow-list if needed and add
a fixture line proving the allow-list works).
**Commit:** `docs(meta): navigation.yml convention, ADR-0018 superseded note, skill residue [HP-E6]`

### HP-E7 Changelog final audit (close the loop)
Re-verify every remaining §0-confirmed omission is now disclosed in
CHANGELOG's v0.2.0 section. Checklist — grep for each, add a line if absent:
- [ ] `headersContentCache` new export
- [ ] hook payload `content:file:beforeParse` `{ _id }` → `{ id }`
- [ ] dev-mode removed-envelope-field query warning (the migration safety
      net — advertise it)
- [ ] `./provider` subpath exports values (not types-only)
- [ ] explicit-id retirement: prerendered builds fail loudly; SSR-only
      deployments ship literal `$alias` hrefs with only a parse-time warning
      on the defining file
- [ ] snapshot runtime invariant: frontmatter is JSON-valued in prod (YAML
      `Date` → ISO string, `undefined` props dropped / array slots → `null`,
      `NaN`/`Infinity` now FAIL the build instead of serializing to `null`)
- [ ] reference match order sentence (search `match order is`): must read
      canonical-source-path first, then `ref` (the code consults
      `byCanonical` → `byRef`; the code matches 0.1.7 — fix the sentence,
      not the code)
- [ ] `dir` rename row (from HP-C1) and locale-order note (HP-C4: restored
      to config order — disclose only if any consumer-visible change remains)

**Accept:** each item findable via grep in CHANGELOG.md; G-drift green.
**Commit:** `docs(changelog): complete 0.2.0 disclosure audit [HP-E7]`

**Phase gate:** G-full.

---

## 10. Phase 6 — Cross-repo handover (edit THIS repo's docs only)

### HP-F1 Amend `refactor-todo.md` §9 (the ginko-cms cutover contract)
Append (do not rewrite existing items) a dated addendum:
- [ ] Two uncatalogued test files speak the old wire/envelope:
      `ginko-cms/test/shared/nuxt-provider.test.ts` (1,259 lines, ~20
      old-field refs) and
      `ginko-cms/test/shared/nuxt-provider-package-conformance.test.ts`.
- [ ] Old-provider read surface is broader than item 1 states: also
      `limit/skip/first/count/cursor/without/resolveVariant`.
- [ ] `canonicalPath` emission sites: `nuxt-provider.mjs` ~462/488/1022.
- [ ] **The silent failure mode, verbatim:** old provider + new wire ⇒
      `input.where` is `undefined` ⇒ `normalizeWhereClauses()` → `[]` ⇒ every
      filter passes ⇒ full unfiltered collection served with HTTP 200.
      Containment: peer range `^0.1.6` excludes 0.2.0 on npm; the hazard is
      workspace/vitest-alias setups (ginko-cms test aliases already point at
      this branch's source). With the wire-version check now enforced
      (Phase 0), ginko-content REJECTS old-shaped queries loudly — but
      nothing in ginko-content can protect a consumer that calls the old
      provider directly.
- [ ] **Mandatory gate for the cutover commit:** ginko-cms must run
      `runProviderContractSuite` (from `@lupinum/ginko-content/testing`;
      verify the exact export name via `git grep runProviderContractSuite
      packages/content/src/testing` and correct this line if it differs)
      against its real provider before landing.
- [ ] R-5 note: a registration-time wire-version handshake is deferred to
      0.2.x — record as a §9 follow-up item.

**Accept:** §9 addendum present; `pnpm docs-drift` green.
**Commit:** `docs(handover): §9 addendum — uncatalogued tests, silent-failure mode, mandatory conformance gate [HP-F1]`

---

## 11. Phase 7 — Post-tag backlog (record, do not implement now)

Create `future-decisions.md` entries (or extend the existing file — match its
format) for: **G1** prerender graph hoisting (O(N²) at 2k docs, pre-existing;
CI canary with a ~500-doc corpus + time ceiling), **G2** client-facing
stale-snapshot 500 body in dev, **G3** parse/serve-time diagnostic at the
*referencing* document for unresolved `$alias` links, **G4** npm provenance
on publish, **G5** per-app agent registry if multi-app isolation is ever
needed (R-4), **R-5** provider wire-version registration handshake.

**Commit:** `docs: post-0.2.0 backlog from hardening review [HP-G]`

---

## 12. Cornerstones (code examples for the non-obvious tasks)

### CS-1 Blanket underscore guard (HP-C1 step 4)
```ts
// test/contracts/query-contracts.test.ts
const assertNoUnderscoreKeys = (value: unknown, where: string) => {
  if (!value || typeof value !== 'object') return
  for (const key of Object.keys(value as Record<string, unknown>)) {
    // Only top-level envelope keys are module-owned; user frontmatter may
    // legitimately contain underscores in nested data, so don't recurse
    // into `body`/user fields — walk result items' top level + `resolved`.
    expect(key.startsWith('_'), `${where}.${key} is module-owned underscore metadata`).toBe(false)
  }
}
// apply to: standard query result items, variant-resolution results
// (the withDirConfig path!), navigation items, surround items.
```

### CS-2 docs-drift self-test harness (HP-A4)
```js
// scripts/docs-drift.mjs — pattern lists become self-verifying:
const PATTERN_GROUPS = [
  { name: 'stale-public-api', patterns: stalePublicApiPatterns },
  { name: 'current-envelope-drift', patterns: currentEnvelopeDriftPatterns },
  // ...every existing group
]

const selfTest = async () => {
  const fixture = await readFile(
    new URL('./docs-drift-fixtures/positive-controls.md', import.meta.url), 'utf8')
  const lines = fixture.split('\n')
  const dead = []
  for (const group of PATTERN_GROUPS)
    for (const pattern of group.patterns)
      if (!lines.some(line => pattern.test(line))) dead.push(`${group.name}: ${pattern}`)
  if (dead.length) {
    console.error('docs-drift self-test: dead detector pattern(s):\n' + dead.join('\n'))
    process.exit(1)
  }
}
await selfTest() // always — a detector that matches nothing anywhere is a bug
```
Fixture file: one labeled offender line per pattern, e.g.
`page._path <!-- current-envelope-drift positive control -->`.
Note: `RegExp.prototype.test` with `/g` flags is stateful — construct
patterns without `g`, or reset `lastIndex` in the loop.

### CS-3 navigationQuery capability enforcement (HP-B4)
```ts
// packages/content/src/runtime/server/providers/index.ts — wrapper target shape:
navigationQuery: provider.navigationQuery
  ? async (event, query, options) => {
      assertProviderOperationSupported(provider, provider.capabilities.navigation, 'navigation')
      assertJsonPureProviderQuery(provider, query)
      assertProviderQuerySupported(provider, query)    // ← the missing line
      return await provider.navigationQuery!(event, query, options)
    }
  : undefined,
```
IMPORTANT: the Phase-0 `query.v !== PROVIDER_QUERY_VERSION` check lives
INSIDE `assertProviderQuerySupported` (search `unsupported provider query
version`) — so today `navigationQuery` has NO version check either, and this
single added call fixes capabilities AND version at once. Add a version
negative test on the navigation path too (`{ ...query, v: 2 }` → typed
rejection).
Test sketch (`test/contracts/provider-contracts.test.ts`, mirror the existing
`query`-path capability tests — same fixture provider, same error matcher):
```ts
it('navigationQuery rejects operators the provider does not declare', async () => {
  const provider = registerLimitedProvider({ operators: ['$eq'] })   // reuse existing helper
  const { query } = toContentProviderNavigationQuery({ where: { title: { $contains: 'x' } } })
  await expect(wrapped.navigationQuery!(event, query)).rejects.toMatchObject({
    data: { code: 'unsupported_query_operator' }        // match the query-path test's exact shape
  })
  expect(provider.navigationQuery).not.toHaveBeenCalled()
})
```

### CS-4 Locale-order helper (HP-C4)
```ts
// features/localization/ (new or existing util module):
/** Canonical locale order: default locale first, then config order. */
export const sortLocalesCanonically = (
  locales: string[],
  config: { defaultLocale?: string, locales?: string[] }
): string[] => {
  const configOrder = [
    ...(config.defaultLocale ? [config.defaultLocale] : []),
    ...(config.locales ?? [])
  ]
  const rank = new Map(configOrder.map((locale, index) => [locale, index]))
  return [...locales].sort((a, b) =>
    (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER)
    || a.localeCompare(b))
}
```
Apply at ASSEMBLY sites only (where `variants` arrays / `availableLocales`
are first built) — grep `availableLocales` and `variants` under
`core/query/execute.ts`, `core/content/graph.ts`,
`features/localization/results.ts`; do not sort in consumers.

### CS-5 Snapshot symbol-key + path-carrying errors (HP-C6)
```ts
// core/content/snapshot.ts — inside findNonJsonValue's object branch:
if (Object.getOwnPropertySymbols(value).length > 0) {
  return `${path} (symbol-keyed property — dropped by JSON serialization)`
}
// Aggregation: collect ALL offending paths per document, not just its id:
const offenders: Array<{ id: string, paths: string[] }> = []
// ... walker returns path strings; push { id: documentIdOf(document), paths }
// Error message: offenders.map(o => `${o.id} (${o.paths.join(', ')})`).join('; ')
```
Note: the walker currently returns the FIRST offending path per document
(single string). Either collect-and-continue inside the walker, or call it
repeatedly stripping found offenders — prefer the simplest change that makes
the error name *at least one precise path per lossy doc*; full multi-path
listing is nice-to-have, not required by the Accept.

### CS-6 Value-preservation diff harness (HP-C7)
```bash
# Two clean builds (never build inside the working checkout for the baseline):
git worktree add /tmp/gc-017 v0.1.7 && (cd /tmp/gc-017 && pnpm install --frozen-lockfile && pnpm build:packages)
(cd /tmp/gc-017/playground/ginko-i18n && pnpm nuxi generate)
(cd playground/ginko-i18n && pnpm nuxi generate)      # HEAD build in-repo is fine
```
```js
// scratchpad decode-and-diff (run with node; NOT committed):
// 1. For each .output/public/**/_payload.json in both trees:
//    - devalue-decode (the payload is devalue-encoded; the repo's own tests
//      show the decode pattern — grep `_payload` under test/ for the helper)
// 2. Flatten to sorted "path/to/key = value" lines.
// 3. Apply the rename map (old→new envelope names, `_dir`→`dir`).
// 4. Normalize volatile: integrity hashes, timestamps, _nuxt/* hashed names.
// 5. Diff. Whitelist ONLY the disclosed deltas (HP-C7 Accept list).
git worktree remove /tmp/gc-017 --force   # cleanup, always
```

### CS-7 Hard-won pitfalls (read before Phases 2–4)
- `git grep -E` ignores `\b` word boundaries on this system — **always use
  `git grep -P`** (recorded incident, refactor-todo.md §2).
- `import.meta.dev` guards: purity/warning code is dev-only BY DESIGN — when
  adding enforcement, decide explicitly whether it runs in prod (capability +
  version checks: YES, they are cheap; deep JSON-purity walks: dev-only).
- The tagged `PlanRegex` is `{ type: 'regex', source, flags }` since Phase 0
  — any new code touching plan values must use `isPlanRegex` from
  `core/query/plan.ts`, never shape-sniff `{source, flags}`.
- `meta/public-surface.json` is the single source for facade mirrors — every
  export add/remove needs BOTH the facade file and the JSON updated in the
  same commit, or the mirror tests (correctly) fail.
- Vitest projects: unit tests → `test/unit`, contract tests →
  `test/contracts` (mind the 5-file `contracts-node` include list in
  `vitest.config.ts` — new node-only contract tests must be added there
  explicitly or they silently run under the `nuxt` project).

---

## 13. Definition of done + release checklist (execute in order)

1. [ ] Phases 0–6 complete; §14 has an entry per task with gate results.
2. [ ] `pnpm run release:verify` green end-to-end (this includes
       packed-consumer, browser e2e, search matrix, sitemap, audit, pack).
3. [ ] HP-C7 value-preservation report in §14 shows only disclosed deltas.
4. [ ] CHANGELOG spot-audit: follow the migration guide's own instructions
       verbatim in the quickstart fixture (rename one field per table row,
       run one query per documented example) — every instruction must be
       executable exactly as written.
5. [ ] Delete the stale tag: `git tag -d v0.2.0` (it points 10+ commits
       behind; it was never pushed — verify with
       `git ls-remote --tags origin | grep v0.2` → must be empty).
6. [ ] STOP. Tag re-cut, push, and publish are HUMAN actions — leave the
       final state committed locally and write a handover summary at the top
       of §14: what shipped, what's in Phase-7 backlog, exact command the
       human should run (`git tag v0.2.0 && git push … && pnpm release` per
       MAINTAINING.md).

---

## 14. Status Log (append-only, newest first — one entry per task)

Format:
`- **<date> — HP-<id> <done|deviation|blocked>.** <what changed>. Gates: <results>. Proof: <both-directions evidence>. <deviations/notes>.`

- **2026-07-08 — Release-review fix round (workflow, 4 Opus fixers + 3 Opus
  verifiers, all verdicts PASS / zero blocking).** Fixed: locale ordering
  completed across provider-wire (`provider-query.ts`), storage
  (`content.ts`), `canonical:true` branch (`resolve.ts`), and threading in
  `execute.ts`/`manifest.ts` — rule: default locale first, then collection
  `locales[]` order (global fallback), then input order; NOT applied to
  `queryCollectionLocales`/`resolveCollectionLocales` (stay alphabetical,
  pinned by server-reference-contracts.test.ts:245). String-form `$regex`
  flags whitelisted to imsu; snapshot symbol-on-array rejection; executor
  regex comparator throws on untagged object operands (message names the
  tagged shape; PROVIDER_QUERY_VERSION referenced by identifier — importing
  the constant violates the core-does-not-import-runtime boundary test);
  `internalDocumentFields` `_dir`→`dir`; `dir` added to
  `RESERVED_CONTENT_KEYS` (12 keys — stamped at query time by
  `withDirConfig` on `resolveVariant` results only, not at parse);
  underscore-guard test deepened (walks resolved/variants/localePaths/nav
  items, applied to list + navigation results); providers/index.ts tab
  indentation; registry comment corrected (per-process singleton;
  re-registration throws unless `{override:true}`); comark math/mermaid
  dynamic-import rationale documented in source; docs-drift positive
  controls extended to all pattern-based checks. CHANGELOG: locale-order
  disclosure, per-process registry wording, flags whitelist, `beforeParse`
  `{_id}`→`{id}`, reserved set 7→12, `headersContentCache`, snapshot symbol
  rejection + `docId:$.path` errors, Date→ISO, `dir` semantics; migration
  doc `useContentSwitchLocalePath` row; PROVIDER_CONTRACT.md API-impact
  list. Verifier polish applied post-hoc: "every variant result" →
  "variant-resolution (`resolveVariant`) results" in reserved.ts +
  CHANGELOG. Fixer gates: typecheck 0, 542/542 (unit+nuxt+provider+
  contracts-node), docs-drift OK incl. self-test.
- **2026-07-08 — Playbook authored.** Verified done/not-done matrix of the
  inherited uncommitted tree recorded in §1; rulings R-1…R-10 issued in §3.
  Sources: three cross-verified adversarial reviews
  (`release-hardening-todo.md` §0) + direct verification of the working tree.
