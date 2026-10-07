# Ginko Content 1.0: execution plan

This folder is the single plan from today (`v1.0.0-beta.10`, `a3e8ef1`) to a
1.0 release that Lupinum can stand behind. Codex executes it alone, step by
step. Opus wrote it and made every design decision in it. Matthias approved the
13 product decisions on 2026-10-05.

**Codex: read this whole file first. Then do the steps in order.** Do not
reorder steps. Do not invent scope. Where a spec says "decided", do not
re-decide. Where the code disagrees with a spec, follow the
[stop rules](#stop-rules).

## Files

| File | What it is |
|---|---|
| `README.md` | This file: rules, target architecture, step order, progress checklist, gates. |
| `step-00-land-open-work.md` … `step-12-release.md` | One spec per step: problem, target design, tasks, verification. |
| `findings.md` | The register of every finding (IDs `A-`, `B-`, `C-`, `D-`, `E-`, `F-`, `G-`, `P-`). Evidence lives there. Update only the status words. |
| `log.md` | Codex appends one entry per finished task and step (create it in step 0). |
| `questions.md` | Codex writes blocked questions here (create it when needed). |

## The goal in one paragraph

Every feature Ginko Content claims works, and a deployed demo proves it at
desktop and mobile. The internals have one source of truth per concept. Build
time does the work once. The browser gets render-only code. One extension
contract (`ContentDataSource`). A small, documented, frozen public surface.
Budgets for bundle size, build time and latency are enforced in CI. The three
Ginko consumers run on the release candidate without workarounds.

## Definition of done for 1.0 (measurable)

| # | Criterion | Done when |
|---|---|---|
| 1 | API | The export map equals the list in [step 8](step-08-public-surface.md). `pnpm api-docs:check` passes. Every export appears in `docs/content/docs/5.reference/`. |
| 2 | Real use | All 6 demos and ginko-cms, ginko-editor, ginko-docs, ginko-kit build and pass their tests on the packed RC tarball, with no deep imports and no `as unknown as` casts against Ginko types. |
| 3 | Architecture | `pnpm lint` includes the import-boundary rules from [step 9](step-09-guardrails.md) and passes. No duplicate owner for: errors, cache hints, query execution, render policy, locale-prefix splitting. |
| 4 | Budgets | CI enforces: quickstart first-page JS ≤ 85 kB gzip; `body-renderer` Vite app ≤ 25 kB gzip of Ginko + Comark-Vue code (no parser, no Zod, no YAML); static generate of 2,000 docs finishes in ≤ 2.5× the time of 1,000 docs and without heap exhaustion; search request p95 ≤ 150 ms server time at 2,000 docs. |
| 5 | Search | Every query in `ginko-content-demos/checks/search-queries.json` returns its expected page first. X003, X004, X005, X006, X103, X401 pass. |
| 6 | Live | Every demo check (C-, X-, K-) passes in production at both viewports, or is listed in `findings.md` as "out of scope for 1.0" with a reason Opus or Matthias accepted. Zero `fail`. |
| 7 | Docs | A fresh agent follows the quickstart on a clean machine and reaches a working page in ≤ 10 minutes, measured and logged. Migration guide from beta.x exists. |
| 8 | CI | PR CI median ≤ 10 min over the last 10 runs. No test depends on wall-clock ratios. |
| 9 | Stability | `docs/content/docs/7.resources/5.support-and-stability.md` states semver rules, deprecation policy, the integration-surface rule, and the tested Nuxt, Vue and Node ranges; CI tests the lowest and highest. |
| 10 | Security | `pnpm audit:prod` clean. `pnpm audit:all` clean, or each remaining advisory has a maintainer decision recorded in `MAINTAINING.md` by Matthias. |

## Target architecture

Today the library has two extension contracts, query code spread over 4
layers, derived data (search, agent Markdown, sitemap facts) recomputed per
request, and a browser bundle that ships the parser and Zod. The target:

```
content files ─┐
               ▼
   BUILD (Nitro, once)          core/ (pure TS: no Nuxt, H3, Vue, Nitro)
   ingest → validate → derive ───────────────────────────────────────────
   │  parse (Comark)            parse · graph · query engine · derive
   │  render-safety + links     (routes, navigation, search docs,
   │  → validation report         sitemap facts, agent index)
   ▼  (file:line, all at once)
   snapshot.json (frozen) + derived artifacts (search index, agent index)
               │
   SERVER (Nitro runtime)       server/: H3 handlers are thin adapters
   ├─ filesystem: reads the snapshot, never re-derives
   └─ external: ContentDataSource ← the ONLY extension contract
               │                    (module binds it; users never see ContentProvider)
               ▼  HTTP JSON API
   BROWSER (Vue)                app/: render-only. No parser, no Zod, no YAML,
   useContentPage('docs')       no content.config import. Parser loads lazily
   <ContentRenderer>            only inside <ContentRendererInline>.
```

Rules that hold at the end (step 9 enforces them in CI):

1. `core/**` imports nothing from `nuxt`, `#imports`, `h3`, `nitropack`, `vue`, `runtime/**`, `module/**`.
2. `runtime/app/**` imports nothing from `cms-contract/index`, `parsers/**`, `storage/**`, `integrations/**`, `module/**`, `zod`, `js-yaml`, or `comark` (except one dynamic `import()` in `ContentRendererInline.vue`).
3. App code names collections by string (`'docs'`). Collection handles exist only in `content.config.ts` and server code.
4. One owner per concept: errors `core/errors.ts`; cache hints `core/cache-hints.ts`; query execution `core/query/`; render policy validation `core/markdown/render-policy.ts`; locale prefix `core/content/path.ts`.
5. Every derived artifact (routes, navigation, search index, agent index, sitemap facts) is computed once from the frozen snapshot, at build time for the filesystem source, or once per process and snapshot integrity at runtime.
6. Authoring problems are reported at ingest, all at once, with file and line. The page renderer never throws for content.

## Step order and progress

Mark each box when its "Done when" check passes and the evidence is in
`log.md`. Sizes are Codex working time, not wall time.

- [ ] **[Step 0](step-00-land-open-work.md): Land open work, set up `release/1.0`** (~2 h)
  - [x] 0.1 Plan on remote, `release/1.0` branch, worktree, log file (done by Opus)
  - [ ] 0.2 Local 6-commit stack → PR into `release/1.0`
  - [ ] 0.2b `feat/kit-v2` (lean body renderer, prerender opt-out) → PR into `release/1.0`
  - [x] 0.3 Heading-anchor WIP saved on `origin/wip/heading-anchors` (done by Opus; finished in step 2)
  - [ ] 0.4 Dependency cleanup: drop `globby`, `nitropack`, duplicate deps (closes `braces`, `node-forge` in prod graph)
  - [ ] 0.5 PRs #89 and #90 retargeted to `release/1.0`, green, merged there
  - [ ] 0.6 Package build without warnings
- [x] **Step 1: Identity safety** (done in PR #89: E-A001, E-A002, E-A007, E-A011 freeze, navigation non-mutation)
- [ ] **[Step 2](step-02-authoring-correctness.md): Authoring correctness at ingest** (~8 h)
- [ ] **[Step 3](step-03-query-correctness.md): Query engine correctness** (~4 h)
- [ ] **[Step 4](step-04-render-only-browser.md): Render-only browser path** (~6 h)
- [ ] **[Step 5](step-05-one-data-source-contract.md): One data-source contract** (~8 h)
- [ ] **[Step 6](step-06-derive-once.md): Derive once (search, agent, sitemap, static scale)** (~10 h)
- [ ] **[Step 7](step-07-delivery.md): Runtime and static delivery on Vercel** (~5 h)
- [ ] **[Step 8](step-08-public-surface.md): Public surface and page API** (~8 h)
- [ ] **[Step 9](step-09-guardrails.md): Guardrails: import boundaries and budgets in CI** (~4 h)
- [ ] **[Step 10](step-10-tests-and-ci.md): Test surgery and CI** (~6 h)
- [ ] **[Step 11](step-11-docs-and-claims.md): Docs, examples, claims** (~8 h)
- [ ] **[Step 12](step-12-release.md): Consumers on the RC, RC release, final sweep** (~6 h + Matthias gates)

## Running as one Codex goal

Codex runs this plan as **one goal**: it keeps working, step after step, until
the goal condition below is true. It does not stop after a step. Matthias may
read `log.md` and answer `questions.md` at any time while it runs.

### Goal condition (when the run ends)

The run ends only in one of these two states:

- **DONE:** every task from 0.1 to 12.4 is ticked or recorded as
  `waiting: G<n>` / `blocked: Q<n>` in this checklist, the PR `release/1.0` →
  `main` is open (12.4), `plans/1.0/report.md` (12.6) is written and committed
  on `release/1.0`, and `log.md` ends with a final status block. Task 12.5
  (publish) is Matthias's; the run does not wait for it.
- **STUCK:** every remaining unticked task is blocked by an open question or a
  gate, and no independent task is left. Write the final status block and end.

Anything else is not an end state. A gate, a failing check or a blocked task
is never a reason to end the run while independent work remains.

Final status block, appended to `log.md`, one line each:
`Done (verified)` · `Running now` · `Left` · `Needs Matthias` · `Risks`.

### State lives in files, not in memory

Long runs lose context. Keep all state in the repo so you can resume at any
moment:

- **This checklist** (ticked boxes; a task that waits gets the suffix
  `— waiting: G2` or `— blocked: Q3` on its line).
- **`log.md`**: one line per finished task (task ID, commit SHA, command,
  result), one block per finished step, and the current position at the top
  under `## Now` (step, task, branch, open PR URL). Update `## Now` whenever
  you start a task.
- **`questions.md`**: numbered `Q1`, `Q2`, … Each has: task ID, finding,
  file:line evidence, options, Codex's recommendation, and an `Answer:` line
  that Matthias fills in.
- Commit and push `plans/1.0/` changes on the current step branch at least
  after every finished task. Never leave work only in the working tree.

### Resume protocol (start of the run, and after every context reset)

1. `cd /Users/matthias/Git/0_libs/ginko-content-r10 && git fetch --all --prune && git status`.
2. Read this README, the `## Now` section of `log.md`, and `questions.md`.
3. Any `Answer:` that Matthias filled in since the last check unblocks its
   task: untag it and do it before new work.
4. Check open PRs: `gh pr list --base release/1.0 --state open`. A step PR
   that is green and reviewed gets merged before new work starts.
5. Continue with the first task in this checklist that is neither ticked nor
   waiting/blocked.

### Gates and blocked tasks inside one run

- A **gate** (G1–G6) or a **blocked** task never stops the run. Tag the
  task, write the question, continue with the next task that does not depend
  on it.
- A step whose tasks are all ticked except waiting/blocked ones still gets its
  PR, CI, review and merge. The finding stays open with `blocked: Q<n>` in
  `findings.md`. Come back to the task when its answer arrives (resume step 3).
- Check `questions.md` for new answers at every step boundary.
- Dependencies between steps: steps run in order, because each one builds on
  the merged previous one. Inside a step, tasks are independent unless the
  task says otherwise.
- Stop rule S6 (task over 2× its estimate) means: tag it `blocked`, write what
  you tried, move on. It does not end the run.

## How Codex works through a step

Repeat for every step:

1. **Branch.** `git switch release/1.0 && git pull` then `git switch -c step/NN-short-name`.
   Work in the worktree `/Users/matthias/Git/0_libs/ginko-content-r10` (Opus created it).
   Never use Matthias's checkout `/Users/matthias/Git/0_libs/ginko-content`.
2. **Per task:**
   1. Read the task spec and the files it names.
   2. Write the regression test the task names. Run it. **It must fail** for the stated reason. If it passes, apply stop rule S1.
   3. Implement the fix exactly as specified.
   4. Run the task's "Done when" command. It must pass.
   5. Commit with a Conventional Commit message (`fix(search): …`, `feat!: …` for breaking changes). One task = one or more atomic commits. End each message with `Co-Authored-By: Codex <noreply@openai.com>`.
   6. Append a line to `log.md`: task ID, commit SHA, the command, its pass count.
3. **Per step, after all tasks:**
   1. `pnpm verify` (full local gate). Must pass. Report flaky tests, never skip them.
   2. Update `CHANGELOG.md` under `## Unreleased` (Fixes / Changed / Breaking). Breaking entries say what to change in app code.
   3. Update docs the step changes (each step lists them). Then `pnpm docs:build && pnpm docs:smoke && pnpm docs-drift`.
   4. Push, open a PR **into `release/1.0`** with `gh pr create --base release/1.0`. Body: problem, behavior after, finding IDs closed, verification output, limits.
   5. Wait for CI. Fix red CI. Do not mark a red check as flaky without proof (run it 3× on `release/1.0` unchanged).
   6. Run `codex review` (or your built-in review) on the PR diff. Fix every P0/P1/P2 finding or write why it is wrong in the PR.
   7. Merge the PR into `release/1.0` (merge commit, not squash).
   8. **Demo verification** (see below) for the checks the step lists.
   9. Set the finding statuses in `findings.md` to `fixed (step N, PR #…)`. Tick the boxes above. Append the step summary to `log.md`.

### Demo verification loop

The demos live in `/Users/matthias/Git/0_libs/ginko-content-demos` (repo
`lupinum-dev/ginko-content-demos`). Read its `README.md`, `DESIGN.md` and
`AGENTS.md` once.

```bash
# in the ginko-content-r10 worktree, on release/1.0 after the merge
pnpm install --frozen-lockfile && pnpm build:packages && pnpm release:pack
SHA=$(git rev-parse --short HEAD)
cp .pack/lupinum-ginko-content-*.tgz ../ginko-content-demos/vendor/lupinum-ginko-content-1.0.0-rc.0-$SHA.tgz
cd ../ginko-content-demos
git switch -c verify/step-NN-$SHA
corepack pnpm use-ginko vendor/lupinum-ginko-content-1.0.0-rc.0-$SHA.tgz
corepack pnpm build
corepack pnpm check:known-failures
# deploy every demo the step lists to its Vercel production alias (team "Lupinum OG"),
# then run the listed checks against production:
corepack pnpm check <demo>
corepack pnpm check:map
```

Rename the copied tarball only; `use-ginko` handles the rest. Commit the
tarball, `ginko-source.json`, manifests, lockfile and `results/*.json`
together, push the branch, merge it into the demos `main` yourself (the demos
repo is Codex-owned test infrastructure). Delete older vendor tarballs that no
`ginko-source.json` references in the same commit.

A known-failure fixture that now passes moves from `fixtures/known-failures/`
into the demo app it belongs to as a normal passing check (keep its ID).

Deploying the six `ginko-demo-*` Vercel projects (preview and production) is
approved. Deploying anything else is not.

## Stop rules

Stop the current task, write the question to `questions.md` (task ID, what
you found, file:line evidence, the options you see), and continue with the
next task that does not depend on it, when:

- **S1** A regression test passes before the fix (the bug may already be gone or the test is wrong).
- **S2** The code contradicts a fact the spec states (a file, function or behavior is not there).
- **S3** The fix needs a public behavior change that no spec and no decision covers.
- **S4** The fix needs a new runtime dependency the spec does not name.
- **S5** You would delete or weaken a test the spec does not name.
- **S6** A task takes more than 2× its estimate.
- **S7** CI is red for a reason outside the step's diff and not fixed by rerunning once.

These rules stop a **task**, never the run. The run ends only in the DONE or
STUCK state defined in "Running as one Codex goal".

## Never

- Never publish to npm, run `npm publish`, `pnpm publish` or trigger the `Publish` workflow.
- Never push to or merge into `main` in any repo, except `ginko-content-demos` and `ginko-integration-pocs` (Codex-owned test infrastructure). Never force-push a branch someone else pushed (one exception: the #89 rebase in step 0.5).
- Never deploy `ginko-content.lupinum.com` (the docs site) or any Vercel project other than the six `ginko-demo-*` projects.
- Never add an `audit` advisory exception or a dependency-policy exception.
- Never print, read into logs, or commit secret values.
- Never skip, `.skip`, `.todo` or delete a failing test to get green, unless the spec names that test.
- Never change consumer repositories (ginko-cms, ginko-editor, ginko-docs, ginko-kit, ginko-write) outside step 12, and there only on branches with PRs.
- Never work in `/Users/matthias/Git/0_libs/ginko-content` (Matthias's own checkout of `main`). All work happens in `ginko-content-r10` and in worktrees you create.

## Gates that need Matthias

Codex stops at these points, writes the request into `questions.md` and
continues with independent work.

| Gate | When | What Matthias does |
|---|---|---|
| **G1** | Step 0.4, only if `pnpm audit:all` still lists `node-forge` through Nuxt's own dev CLI | Accept or decline a dev-workspace-only advisory decision in `MAINTAINING.md`. |
| **G2** | Step 10.5 | Approve the exact list of release-recovery files to delete (Codex shows each with its git history). |
| **G3** | Step 12.4 | Review and merge `release/1.0` into `main`. |
| **G4** | Step 12.5 | Run the protected `Publish` workflow for `1.0.0-rc.1` and approve the `npm` environment. |
| **G5** | Step 12.2 | Merge each consumer's integration branch into its `main` (decision 12). |
| **G6** | Step 11.7 | Ask Opus for the copy review of the step 11 docs PR; Codex addresses the comments before merging. |

## Finding coverage

Every finding in `findings.md` is closed by exactly one step, or explicitly
not part of 1.0.

| Step | Findings |
|---|---|
| 0 | deps (`braces`, `node-forge`), E-X3 |
| 1 (done) | E-A001, E-A002, E-A007, E-A011 (read-only results; demo check updated in 3.8) |
| 2 | C-11, E-A004, C-12, C-17, E-A005, A-14, E-A013, C-19, C-34, D-02, D-03, C-29, D-06, C-16 |
| 3 | E-A006, E-A009, E-A010, E-A012, C-15, E-A019, E-A017, E-A018 |
| 4 | P-01, D-01, E-A014, C-08, A-08 |
| 5 | A-01, A-07, E-A016, E-A008, C-30, C-28, B-03, B-04, D-05, D-04, C-27 |
| 6 | E-A003, C-35, E-A015, P-03, P-04, C-14, C-20, C-23, C-24, C-25, A-12 (sitemap part), C-09, E-X1 |
| 7 | C-22, C-32, C-33, C-05, P-02 |
| 8 | A-02, A-03, A-04, A-05, A-06, A-09, A-10, A-11, A-13, G-01, G-03 |
| 9 | criteria 3 and 4 (no finding ID) |
| 10 | F-01, F-03, F-05, F-06, E-X2, C-03 (workflow part) |
| 11 | G-02, G-04, G-05, G-06, C-01, C-04, C-06, C-36/C-18/C-26/C-31 (claims) |
| 12 | B-01, B-05, B-06, B-07 |
| Info only | B-02, C-07, C-10, C-13, C-21, D-07, F-02, F-04 |
