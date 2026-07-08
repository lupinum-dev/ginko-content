# Ginko Content — 0.2.0 Release Hardening Playbook (`release-hardening-todo.md`)

Companion to `refactor-todo.md`. Input: three independent adversarial reviews of
`refactor-fable` (v0.1.7 → v0.2.0, HEAD `aea85be`), cross-verified against the
code on 2026-07-08 to filter hallucinations before planning. Every item below
was **re-verified against source/test runs** unless marked otherwise.

Verdict adopted: **do not tag 0.2.0 until Phases A–E are done.** Phases F–G may
land after the tag. The three reviews disagreed on ship/no-ship; that
disagreement is moot — everything they found that is real is fixed here.

---

## 0. Verification summary (hallucination filter)

**Confirmed (all re-verified against HEAD):** every HIGH across all three
reviews, and nearly all MEDIUM/LOW claims. Notable direct confirmations:

- Red test at HEAD: `contracts-node` project = 5 files / 36 tests, run by no
  `test`/`verify`/`release:verify`/CI chain (only manual `test:golden`).
  Fresh run: **35 pass / 1 fail** — `test/contracts/vnext-golden-demo.test.ts:141`
  sends the pre-T3.2 flat query, crashes at `testing/provider-fixture.ts:375`.
- Live `RegExp` leaks through `$in` arrays (`lower.ts:22-25` never walks array
  entries; JSON round-trip → `{}` = silent transport divergence). Repro'd on dist.
- `Date` operands survive lowering live; **worse than reported**: bare
  `{date: new Date(...)}` equality sugar collapses the entire clause to
  `{type:'true'}` — predicate silently dropped (`lower.ts:106` object branch).
- Purity guard is `import.meta.dev`-only (`providers/index.ts:100`) — prod is
  a no-op, dev hard-crashes queries that worked at 0.1.7.
- `query.v` / `PROVIDER_QUERY_VERSION` is write-only (grep: zero readers).
- `navigationQuery` wrapper skips `assertProviderQuerySupported`
  (`providers/index.ts:166-172`).
- No `default:` throw on unknown `FilterExpr` kinds in either walker
  (`providers/index.ts:43-61`, `execute.ts:97-110`) — unknown node ⇒ silent
  empty result. Regex `flags` unvalidated; `{source,flags}` data operands are
  indistinguishable from lowered regexes (repro'd: `$eq` regex-matched data).
- `navigation-query.ts:20-21` `Object.assign` merge loses same-field bounds
  under `$or`/`$not` (repro'd: `$gt` bound vanishes).
- `_dir` still emitted on variant-query envelopes (`execute.ts:224`, attached
  at `:436`), asserted by a contract test, while CHANGELOG says underscore
  metadata is gone.
- CHANGELOG promises types that don't exist (`ContentDocument`) and a guard
  that isn't exported (`isRealDocument`/`MissingDocument` — live at
  `core/content/document.ts:20`, absent from every `public/` facade).
- pagefind → optional peerDependency undisclosed; pagefind docs have no install
  step.
- Blanket `_path → path` / `_fallback → resolved.fallback` migration rows
  (CHANGELOG:69,101) with no NavItem-specific rows.
- Reference-match-order sentence (CHANGELOG:130 "`ref` → path → canonical") is
  inverted vs code (`graph.ts` consults `byCanonical` first, then `byRef`).
- Reserved-key guard covers only 7 identity keys (`parsers/reserved.ts`) —
  frontmatter `resolved:`/`variants:`/`localePaths:`/`unprefixedPath:` flow
  through.
- `setupAgentMarkdownRegistry` has zero production callers; registry is a
  per-process module global (`agent-markdown.ts:39`).
- `#content/provider` alias imported by the flagship example
  (`examples/advanced/cms-cache-contract/server/cms-provider.ts:9`) is
  registered nowhere (`module/virtual.ts` defines only `#content/server` +
  `#content/virtual/*`).
- Docs app: edit link renders `.../docs/content/undefined`
  (`docs/app/pages/docs/[...slug].vue:69` reads deleted `_file`); **new
  functional bug found during verification** — surround prev/next links write
  the `/docs`-prefixed path into dead `_path` while Nuxt UI reads `path`, so
  prev/next navigate to unprefixed routes (lines 16-19).
- Migration doc (`8.migration/2.from-nuxt-content-v3.md:259-267,518`) and the
  bundled skill (`skills/ginko-content/references/querying-rendering.md:66-90`,
  `SKILL.md`, `references/i18n.md`) teach `_path`/`_id` as *current* Ginko API.
- `docs-drift.mjs` detectors fail open (pure absence checks, no positive
  controls; its own header admits the self-test was dropped); it polices
  `_fallback` (a name that no longer exists) and has no envelope-field patterns
  at all — it greenlights exactly the drift above.
- `meta/ARCHITECTURE.md:82` + `meta/ABSTRACTIONS.md:30` say `_navigation.yml`;
  code accepts `.navigation.yml` only. ADR-0018 still "rejects" the `./agent`
  subpath that `package.json` now ships.
- comark plugin loading: server `parsers/markdown-plugins.ts:177`
  `import(/* @vite-ignore */ specifier)` under forced `noExternal`; client
  `runtime/markdown/plugins.ts:14,21` bare-specifier joins. Pre-existing at
  0.1.7 (not a regression) but same class as the fixed transformers bug.
  `runtime/app/plugins/markdown-components.ts` exists and is registered nowhere.
- Generated components module emits **unquoted** object keys
  (`module/content-components-template.ts:62` — `3dViewer` ⇒ SyntaxError)
  while quoting the same name two lines up; `module/runtime-assets.ts:207-210`
  interpolates a filesystem path into generated code without `JSON.stringify`.
- Snapshot error aggregation keeps only doc IDs (`snapshot.ts:110`) though the
  walker computes exact offending paths.
- Hook payload rename `content:file:beforeParse` `{_id}` → `{id}`
  (`module/augmentations.ts:85` vs v0.1.7) — undisclosed.
- ginko-cms: provider reads only flat `input.where` (never `plan`/`v`;
  `nuxt-provider.mjs:598` normalizes `undefined` → `[]` ⇒ **full unfiltered
  collection with HTTP 200** on the new wire). `test/shared/nuxt-provider.test.ts`
  (1,259 lines, 20 old-field refs) + `nuxt-provider-package-conformance.test.ts`
  are absent from §9 of `refactor-todo.md`. Peer range is `^0.1.6`, so npm
  consumers won't auto-pick 0.2.0 — the silent failure bites **workspace/dev
  alias setups only** (ginko-cms vitest aliases already point at branch source).

**Refuted / corrected review claims (do NOT act on these as stated):**

- "docs-drift runs in no CI chain" — **wrong**: CI runs `pnpm docs-drift` on
  every PR (`ci.yml:34`) and again inside `release:verify`. The real issue is
  that its detectors fail open (above).
- "The surviving facade mirror test sits in the unrun contracts-node project" —
  **wrong**: `test/contracts/package-exports-contracts.test.ts` runs in the
  `nuxt` project on every `pnpm test`. The real gap stands: mirror tests exist
  only for `public/agent.ts` + root `module.ts`; client/server facades are
  never diffed against `meta/public-surface.json`.
- Review 2's dirty-tree note (`public/client.ts` user edit) — tree is clean at
  HEAD now; nothing to do.

**Accepted on multi-review consensus (not re-repro'd here — both reviews built
both versions independently and agree):** `variants[]` /
`resolved.availableLocales` order flipped (`["en","de"]` → `["de","en"]`);
NavItem/neighbor `stem` values changed truncated→full (0.1.7 double-strip bug
fixed, undisclosed); O(N²) prerender build path is pre-existing at 0.1.7;
dev↔prod drift for YAML `Date`/`undefined` frontmatter.

**Explicitly UNVERIFIED (both reviews flagged, nobody proved either way):**
packed-consumer dual-module-instance risk for serializer registration — the
packed-consumer test never registers a serializer from the installed package.
Treat as "write the test, see what happens" (Phase D-10).

---

## 1. Strategy

Sequencing principle: **guardrails first, then fixes, each fix landing with the
test that would have caught it.** The refactor's misses cluster where
enforcement was deleted or never wired (contracts-node unrun, facade mirrors
deleted, docs-drift self-test dropped) — so restoring enforcement is Phase A,
before any behavioral fix, so every later phase is provable.

Rules of engagement (inherit `refactor-todo.md` §3 verification protocol):

1. Every fix commit pairs with a regression test proven in both directions
   (fails on the bug, passes on the fix) unless it is pure prose.
2. After Phase C (envelope changes), re-run the value-preservation diff:
   build `playground/ginko-i18n` at v0.1.7 and HEAD, decode `_payload.json`,
   apply the rename map, assert byte-equality except the *disclosed* deltas.
3. Full gate before tagging: `pnpm run release:verify` **plus** the newly wired
   contracts-node project, green.
4. No scope creep into new features. This playbook returns the tree to "claims
   true, wire closed, docs honest" — nothing else.
5. Maintain a Status Log at the bottom of this file, same discipline as
   `refactor-todo.md` §2.

---

## 2. Phase A — Restore enforcement (do first; ~half a day)

- [ ] **A1. Wire `contracts-node` into the test chain.** Add
  `--project contracts-node` to the `test` script (it already builds packages
  first, which contracts-node needs). This surfaces the red golden test (A2).
- [ ] **A2. Fix `test/contracts/vnext-golden-demo.test.ts`** to send the v1
  wire shape (`{v, collection, plan}` via `toContentProviderQuery`) instead of
  the pre-T3.2 flat query (crash at `provider-fixture.ts:375`).
- [ ] **A3. Restore facade mirror tests.** In
  `test/contracts/package-exports-contracts.test.ts`, add the same
  `extractValueExports/extractTypeExports ⇔ public-surface.json` key-diffs that
  exist for `agent.ts` (lines 106-118) for **`public/client.ts`,
  `public/server.ts`, and `public/provider.ts`**; add a package `exports`-map
  key-diff against a committed expected list. Acceptance: injecting
  `export const __undocumentedLeak = 1` into any facade fails `pnpm test`.
- [ ] **A4. docs-drift positive controls.** (a) Add a self-test mode: every
  detection regex must match at least once against a committed fixture corpus
  (`scripts/docs-drift-fixtures/`), else exit 1 — restores the self-testing the
  script's own header says was lost. (b) Update rotted patterns
  (`_fallback` → also detect misuse of new names) and **add envelope-field
  patterns** (`_path`, `_id`, `_file`, `_extension`, `_locale`, `_stem`,
  `_dir` as *current-API* references in docs/skills — allow explicitly-marked
  "old nuxt-content" before/after blocks).
- [ ] **A5. Docs-build smoke.** After `pnpm docs:build`, grep generated HTML
  for `undefined` in hrefs (catches the `docs/content/undefined` class). Add to
  `verify`.
- [ ] **A6. Examples typecheck.** The flagship example imports a nonexistent
  alias and nothing noticed — add `tsc --noEmit` (or `nuxi typecheck`) over
  `examples/advanced/cms-cache-contract` to `examples:build` or `verify`.

## 3. Phase B — Wire-contract correctness (the true 0.1.7→0.2.0 regressions)

- [ ] **B1. Element-wise regex serialization in lowering.** `lower.ts`: apply
  `serializeRegexValue` to array entries (and nested operand values), not just
  the top-level operand. Test: `$in: [/^intro/, 'other']` lowers to
  `{source,flags}` entries; plan survives `JSON.parse(JSON.stringify(...))`
  with identical match results.
- [ ] **B2. Date operands.** Decide once (see §8 D-1) then implement: lower
  `Date` → ISO string in compare operands **and** fix the bare-Date equality
  sugar (`lower.ts:106` object branch currently collapses the clause to
  `{type:'true'}`). Tests: `$gt: new Date(...)` and `{date: new Date(...)}`
  both produce JSON-pure plans whose in-process and JSON-round-tripped results
  are identical.
- [ ] **B3. Enforce the wire version.** Assert
  `query.v === PROVIDER_QUERY_VERSION` centrally (in
  `enforceProviderCapabilities` / the registry wrappers) for **both** `query`
  and `navigationQuery`; typed error `provider_query_version_mismatch`.
  Negative test with `v: 2`.
- [ ] **B4. `navigationQuery` capability enforcement.** Call
  `assertProviderQuerySupported(provider, query)` in the wrapper
  (`providers/index.ts:166-172`). Negative tests: unsupported operator and
  `limit:false` provider both reject on the navigation path.
- [ ] **B5. Close the plan walkers.** `default: throw` (typed
  `provider_query_unsupported_node`) in `collectPlanFilterOperators`
  (`providers/index.ts:43-61`) and `evaluateQueryPlanFilter`
  (`execute.ts:97-110`). Test: `filter: {type:'mystery'}` throws instead of
  returning silent empties.
- [ ] **B6. Regex flags whitelist.** Validate flags ⊆ `imsu` at lowering AND at
  revive (`isPlanRegex` in `plan.ts:49-57`); typed error instead of raw
  `SyntaxError` mid-execution. Document "revive per-match, never cache revived
  regexes" (stateful `g`/`y`) in `PROVIDER_CONTRACT.md`.
- [ ] **B7. Fix navigation reverse-lowering.** `navigation-query.ts:20-45`:
  reverse-lower `and` branches to `$and` arrays instead of `Object.assign`
  merge so same-field bounds survive under `$or`/`$not`. Test:
  `$not:{views:{$gt:5,$lt:10}}` returns the same set via navigation and
  standard queries.
- [ ] **B8. (With D-1 ruling) PlanRegex provenance.** At minimum document that
  `{source,flags}`-shaped data operands are interpreted as regexes on the wire;
  preferably reject ambiguous plain-object compare operands at lowering with a
  typed error.

## 4. Phase C — Envelope integrity & value preservation

- [ ] **C1. `_dir` fate (needs D-2 ruling).** Recommended: rename to `dir`
  (non-underscore, documented) on variant-query envelopes; update
  `execute.ts:217-229`, the asserting contract test
  (`query-contracts.test.ts:260`), and add a CHANGELOG row. Then add the
  blanket contract test: *no `_`-prefixed module-owned keys on any public query
  result* — this is the test whose absence let `_dir` survive.
- [ ] **C2. `navigationFile` honesty (needs D-3 ruling).** It serializes on
  every full envelope and playgrounds query it over the wire, so it *is*
  public. Recommended: keep it, fix the "Never a public field" comment
  (`types/content.ts:144`), and correct CHANGELOG:105-106 from "internal" to a
  documented rename `_navigation → navigationFile`.
- [ ] **C3. Reserve the localization envelope keys.** Add `resolved`,
  `variants`, `localePaths`, `unprefixedPath` to `RESERVED_CONTENT_KEYS`
  (`parsers/reserved.ts`) **and strip them at parse time** (warn-and-win is not
  enough here — for non-localized docs nothing overwrites them, so frontmatter
  `resolved:` fabricates system localization state read by
  `features/localization/results.ts:97` / `features/query/localized-docs.ts:53`).
  Test: hostile frontmatter setting all four keys yields a document with
  system values only.
- [ ] **C4. Deterministic locale order.** Derive `variants[]` /
  `resolved.availableLocales` order from collection i18n config (default locale
  first, then config order), not graph insertion order. Restores 0.1.7-observed
  order `["en","de"]`. Test: order is stable across rebuilds and matches
  config order.
- [ ] **C5. NavItem `stem` — keep the fix, disclose it.** HEAD's full stems are
  the correct behavior (0.1.7 double-strip bug). Add a CHANGELOG bugfix bullet
  with example old→new values, plus NavItem-specific migration rows (C7).
- [ ] **C6. Snapshot walker tightening (needs D-6 ruling for (a)).**
  (a) `undefined` admission — **verification found this is deliberate, ruled
  policy**, not an oversight: the top two commits on the branch (`aea85be`,
  `593a32d`) added exactly this admission with a prod-parity rationale, and the
  code comment even acknowledges "(and nulls them in arrays)". Do NOT
  reflexively reverse it (reviews 1/3 flagged it as a bug). Ruling D-6: keep
  the policy and document the dev↔prod drift user-facing (recommended — the E1
  snapshot-invariant bullet covers it), or tighten array-`undefined` to a
  build error. (b) Reject enumerable **symbol-keyed** properties
  (`Reflect.ownKeys` walk) — this one IS a genuine blind spot: repro'd, the
  walker's `Object.entries` skips symbols and prod silently drops them.
  (c) Aggregated `ContentSnapshotError` carries the offending *paths* the
  walker already computes, not just doc IDs (`snapshot.ts:110`).
- [ ] **C7. Re-run the value-preservation gate** (strategy rule 2) and assert
  the only deltas are the disclosed set: envelope renames, locale order (fixed
  by C4), stem bugfix (C5), `navigationFile` (C2), `_dir`→`dir` (C1).

## 5. Phase D — Public surface, aliases, generated code

- [ ] **D1. Export the promised guards.** Export `isRealDocument` +
  `MissingDocument` (type) from `./server` (and `public-surface.json` — the A3
  mirror will enforce). CHANGELOG:115-117 then becomes true.
- [ ] **D2. Fix the phantom type name.** CHANGELOG:56 `ContentDocument` → the
  real name (`ParsedContent`; check `LocalizedContentDocument` mentions too).
- [ ] **D3. `#content/server` lockstep.** Add `PROVIDER_QUERY_VERSION`,
  `toContentProviderQuery`, `toContentProviderNavigationQuery` (+ the T3.4
  provider seam: `normalizeProviderDocument`, `shapeProviderDocument`,
  `ProviderDocumentInput`) to the runtime barrel
  (`runtime/server/index.ts`) and to the generated
  `declare module '#content/server'` block (`module/runtime-assets.ts:39-63`).
  Also add the missing **type** declarations `ShapeProviderDocumentOptions`,
  `ContentPageResult`, `ContentSearchSection` (the example imports them from
  `#content/server`; types-only break today). Add a lockstep assertion test:
  generated declaration list ⊇ public `./server` wire/provider surface.
- [ ] **D4. Fix the example import.** Either register a `#content/provider`
  alias in `module/virtual.ts` (both Nuxt + Nitro sides) or point
  `examples/advanced/cms-cache-contract/server/cms-provider.ts:9` at
  `@lupinum/ginko-content/provider`. A6 keeps it honest.
- [ ] **D5. Export `ContentQueryPlan`** as a named type from `./provider` (the
  provider contract names it; today it's only structurally reachable).
- [ ] **D6. Add `useContentSwitchLocalePath` to `./client`** (it is
  auto-imported and documented, but absent from the facade).
- [ ] **D7. Agent registry honesty (needs D-4 ruling).** Recommended: delete
  `setupAgentMarkdownRegistry` (dead code, false doc comment), document the
  registry as a per-process singleton, and fix the registry test that simulates
  a hook the runtime never fires. If true per-app isolation is wanted, bind the
  registry to the Nitro app context instead — bigger change, post-tag OK.
- [ ] **D8. Serializer envelope disclosure.** CHANGELOG:186-189: keep "call
  signatures unchanged" but add "…the `ctx.page` payload is the renamed
  envelope — see the field map above" (a 0.1.7 serializer reading
  `ctx.page._path` now gets `undefined`).
- [ ] **D9. Generated-code injection edges.** (a) Quote the loader object key:
  `content-components-template.ts:62` — use the existing `nameLiteral` as the
  key (fails today on `3dViewer.vue`). (b) `runtime-assets.ts:207-210`: wrap
  the interpolated module path in `JSON.stringify` (Windows backslashes).
  Tests: a `3d-viewer.vue` fixture component; generated snippets parse with
  `new Function`/`acorn`.
- [ ] **D10. Packed-consumer serializer test.** Add a
  `server/plugins/serializers.ts` registering a custom serializer from the
  *installed* package inside `scripts/test-packed-consumer.mjs` + one
  custom-tag assertion — settles the UNVERIFIED dual-module-instance risk.
- [ ] **D11. comark plugin loading (pre-existing; may land post-tag).** Convert
  the server plugin table (`parsers/markdown-plugins.ts:177`) to static/literal
  imports (same pattern as the already-fixed `toc`/`footnotes`/`highlight`)
  and give the client math/mermaid loaders literal specifiers
  (`runtime/markdown/plugins.ts:14,21`). Delete or register the dead
  `runtime/app/plugins/markdown-components.ts`. Test: packed-consumer build
  with `breaks` + `math` enabled renders both.

## 6. Phase E — Docs & changelog contract (pure prose + two code fixes)

- [ ] **E1. CHANGELOG corrections/additions (one pass):**
  - pagefind → optional peer (breaking install step for `engine:'pagefind'`).
  - NavItem-specific migration rows: `NavItem._path → unprefixedPath`,
    `NavItem._fallback → fallback` (top-level; nav items have no `resolved`).
  - `stem` value bugfix disclosure (C5).
  - `navigationFile` wording (C2 outcome); `_dir` row (C1 outcome).
  - `search.filterQuery` **default-value change**
    (`{_draft:false,_partial:false}` → `{draft:false,partial:false}`,
    `module/defaults.ts:13`). Corrected semantics (review 1 had it backwards):
    a user override still using `{_draft: false}` now excludes **every**
    document (strict `===` against `undefined`) — **empty search results**,
    not leaked drafts. `extraFields` itself was NOT renamed — only its
    *values* (old field names like `_path`) silently yield nothing. Disclose
    both; consider a dev warning for underscore keys in these options (the
    lowering-time warning does not cover module options).
  - Reference-match-order sentence: code order is canonical-first
    (`byCanonical` → `byRef`) — fix the sentence (code matches 0.1.7).
  - Serializer `ctx.page` note (D8).
  - `headersContentCache` new export; dev removed-field query warning (it's the
    migration safety net — advertise it); hook payload `{_id}→{id}` on
    `content:file:beforeParse`; `./provider` exports values not just types.
  - Explicit-id retirement failure mode: prerendered builds fail loudly;
    SSR-only deployments ship literal `$alias` hrefs silently — one sentence +
    (optional, G3) a diagnostic at the referencing site.
  - Snapshot invariant: "frontmatter is JSON-valued at runtime" — YAML `Date`
    becomes ISO string in prod, `undefined`-valued keys are dropped,
    `NaN`/`Infinity` now fail the build (was: serialized to `null`).
- [ ] **E2. Docs app fixes.** `docs/app/pages/docs/[...slug].vue`: edit link
  ← `page.file?.path` (line 69); surround links write the prefixed value to
  `path` (not dead `_path`, lines 16-19 — currently prev/next navigate to
  unprefixed routes).
- [ ] **E3. Migration doc.** `8.migration/2.from-nuxt-content-v3.md`: the
  "Ginko field" column and checklist (lines 259-267, 518) must teach the new
  envelope (`path`, `id`, `file.extension`) — currently teaches `_path`/`_id`
  as current API.
- [ ] **E4. Bundled skill.** `skills/ginko-content/`: rewrite the "`_path` vs
  `path`" section and all `_path`/`_locale` references
  (`references/querying-rendering.md`, `references/i18n.md`, `SKILL.md`,
  `references/search-sitemap.md`).
- [ ] **E5. pagefind docs.** `docs/.../7.search/2.pagefind.md`: add the
  `pnpm add -D pagefind` step.
- [ ] **E6. Meta docs.** `meta/ARCHITECTURE.md:82` + `meta/ABSTRACTIONS.md:30`:
  `_navigation.yml` → `.navigation.yml`. ADR-0018: add a "superseded on this
  point" note for the `./agent` subpath.
- [ ] **E7. A4's new detectors must catch E3/E4 classes** — prove by reverting
  one doc fix locally and watching docs-drift go red (positive control).

## 7. Phase F — Cross-repo (ginko-cms) — coordinate, do not execute from here

- [ ] **F1. Amend `refactor-todo.md` §9:** add
  `test/shared/nuxt-provider.test.ts` (1,259 lines on the old wire/envelope)
  and `test/shared/nuxt-provider-package-conformance.test.ts` to the cutover
  catalogue; add the old-provider read surface undersell
  (`limit/skip/first/count/cursor/without/resolveVariant`) and the
  `canonicalPath` emission sites.
- [ ] **F2. Document the silent failure mode in §9 explicitly:** old provider
  + new wire ⇒ `input.where` undefined ⇒ `normalizeWhereClauses` → `[]` ⇒
  full unfiltered collection, HTTP 200. Note the containment: peer range
  `^0.1.6` excludes 0.2.0 on npm — the hazard is workspace/vitest-alias setups
  (already live on this branch).
- [ ] **F3. Make the conformance gate mandatory:** ginko-cms's cutover commit
  must run `runProviderContractSuite` (with B3's version check in place, the
  old provider now fails *loudly*) against its actual provider before landing.
- [ ] **F4. Registration-time handshake (design, with D-5 ruling):** consider
  requiring providers to declare the wire version they speak at registration
  and refusing mismatches at boot — turns the remaining silent class into a
  startup error.

## 8. Decision points (rulings to record in the Status Log before the phase)

- **D-1 (Phase B2/B8):** Dates on the wire — lower to ISO strings (recommended;
  matches JSON round-trip semantics already observed) vs reject with typed
  error at the builder seam. Same ruling should cover ambiguous
  `{source,flags}` data operands.
- **D-2 (C1):** `_dir` — rename to public `dir` (recommended) vs delete the
  decoration outright (check playground/docs usage first).
- **D-3 (C2):** `navigationFile` — public documented field (recommended; it's
  load-bearing over the wire today) vs strip-and-provide-alternative.
- **D-4 (D7):** agent registry — document per-process singleton + delete dead
  setup (recommended, small) vs bind to app context (correct-but-larger).
- **D-5 (F4):** provider wire-version handshake at registration — in 0.2.0 or
  0.2.x follow-up.
- **D-6 (C6a):** snapshot `undefined` admission — keep the ruled prod-parity
  policy + document user-facing (recommended), or tighten array-`undefined`
  into a build error (reverses commits `aea85be`/`593a32d`).

## 9. Phase G — Post-tag hardening (explicitly OK after 0.2.0)

- [ ] **G1. Prerender graph hoisting.** The per-page graph rebuild during
  forced full-site prerender is O(N²) (~15 s/page at 2k docs; pre-existing at
  0.1.7, prod *serving* path already fixed). Hoist the graph to process scope
  during prerender, mirroring prod. Add a CI canary: ~500-doc generated corpus
  builds under a time ceiling.
- [ ] **G2. Client-facing stale-snapshot 500.** The clear diagnostic is
  log-only; surface a terse actionable message in the response body in dev.
- [ ] **G3. Explicit-id retirement diagnostics.** Emit a parse/serve-time
  warning at the *referencing* document when a `$alias` link fails to resolve
  (SSR-only deployments currently ship literal hrefs with no signal).
- [ ] **G4. npm provenance** (`--provenance` on publish) — GC-3 residue.
- [ ] **G5. D-4 "correct-but-larger" branch** if ruled: app-context-bound agent
  registry + two-app isolation test.

## 10. Definition of done

0. **Re-cut the tag.** A local `v0.2.0` tag already exists **10 commits behind
   HEAD** (never pushed; npm latest is 0.1.6, nothing published). Delete and
   re-tag at the hardened commit — do not push the stale tag. Note
   `headersContentCache` and the two snapshot-admission commits landed *after*
   it, which is how a "released" surface drifted from the tag.
1. `pnpm run release:verify` green **including** contracts-node (A1) and the
   new A3–A6 gates.
2. Value-preservation diff (C7) clean modulo the disclosed delta list.
3. Every CHANGELOG claim in the v0.2.0 section is executable as written
   (imports resolve, names exist, tables correct) — spot-audit by following the
   migration guide verbatim in a scratch app.
4. `refactor-todo.md` §9 amended (F1–F3); ginko-cms conformance gate agreed.
5. Status Log below records every ruling (D-1…D-5) and every deviation.

---

> **Execution note (2026-07-08):** the detailed, agent-executable version of
> this plan is **`release-hardening-playbook.md`** — phases HP-0…HP-G with
> pre-made rulings R-1…R-10, cornerstones CS-1…CS-7, acceptance criteria and
> gates. Execute THAT file; this document remains the strategy/verification
> record (§0 is the authoritative confirmed-vs-refuted findings list).

## 11. Status Log (append-only, newest first)

- **2026-07-08 16:15 — Final verification cluster landed (verified against
  committed HEAD, immune to the concurrent edits).** All 8 envelope/snapshot
  claims confirmed, with corrections folded into C3/C6/D3/E1 and new rulings
  D-6 and DoD item 0: (1) snapshot `undefined` admission is deliberate ruled
  policy (commits `aea85be`/`593a32d`), not a bug — reframed as ruling D-6;
  (2) review 1's search-option claim had inverted semantics and a phantom
  `extraFields` rename — corrected in E1; (3) `execute.ts:308,438` spread
  `...(item.resolved || {})` first, so frontmatter keys inside `resolved`
  survive merges even on resolving paths — parse-time strip (C3, in flight)
  covers it; (4) generated `#content/server` declarations also miss
  `ShapeProviderDocumentOptions`/`ContentPageResult`/`ContentSearchSection`
  (types-only break) — added to D3; (5) a stale local `v0.2.0` tag sits 10
  commits behind HEAD (unpushed, unpublished) — DoD item 0.
- **2026-07-08 16:05 — Concurrent fix pass observed in flight.** While this
  playbook was being written, a parallel session began applying fixes to the
  working tree (33 files modified, uncommitted). Spot-checked diffs already
  cover: A1 (contracts-node in `test`/`test:coverage`), A2 (golden test on v1
  wire), B1+B2+B6+B8 (tagged `PlanRegex` with `type:'regex'` — also solves
  provenance — Date→ISO, element-wise array/object walking, flags validation),
  B3 (version check in providers/index.ts), B5 (`default:` in walker), C3
  (reserved keys + `stripReservedContentKeys`), D3 (barrel lockstep), D4
  (example import), plus E1/E3/E4/E5 prose (CHANGELOG, migration doc, skills,
  pagefind docs). **Whoever picks this up next: diff the tree against this
  checklist before starting anything — do not duplicate; verify each in-flight
  item against its acceptance test instead.** Items NOT yet observed in the
  diff: A3–A6, B4, B7, C1, C2, C4–C7, D1–D2, D5–D11, E2, E6, E7, all of F and G.
- **2026-07-08 — Playbook created.** Three independent adversarial reviews
  cross-verified against HEAD `aea85be`; hallucination filter results in §0.
  Two review claims refuted (docs-drift CI coverage; mirror-test project
  placement), one claim upgraded (bare-Date sugar drops the whole predicate),
  one new bug found during verification (docs surround links lose `/docs`
  prefix). All other claims confirmed as documented above.
