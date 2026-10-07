# Step 10: Test surgery and CI

**Why:** The suite is large (34k test lines for 39k source lines) and still
missed every bug in steps 2–7. Some tests pass on wall-clock luck, one e2e
file is 40 % of e2e time, a 2,268-line snapshot hides regressions, and the
release-safety tooling (~6,000 lines of scripts) is larger than the product
risk. After steps 2–9 changed the architecture, cut the waste once, without
losing behavior coverage.

**Closes:** F-01 (decision 11), F-03, F-05, F-06, E-X2, C-03 (workflow part).
Criteria 8 and 9.

**Branch:** `step/10-tests-and-ci`. **Estimate:** ~6 h + gate G2.

**Rule (from the global test rules):** a test stays only when you can name the
realistic wrong behavior it catches. Prefer real dependencies. No fakes that
re-implement product logic. Delete tests that no longer protect behavior.

## Tasks

### 10.1 Coverage baseline (~30 min)

Add `@vitest/coverage-v8` (same major as `vitest`) as a root devDependency
(named here, so S4 does not apply). Run:

```bash
pnpm build:packages && pnpm prepare:contracts
pnpm vitest run --config vitest.config.ts --project unit --project provider --project contracts-node --project runtime --project client --project nuxt --coverage --coverage.reporter=json-summary --coverage.reporter=lcov --coverage.include='packages/content/src/**'
```

Save `coverage/coverage-summary.json` as
`plans/1.0/evidence/coverage-before.json`. Record test count, line count of
`test/` (`find test -name '*.ts' | xargs wc -l | tail -1`), and the wall time
of `pnpm test:prepared` and `pnpm test:e2e:prepared` in `log.md`.

**Done when:** the baseline file is committed.

### 10.2 Timing tests become operation counts (F-06, E-X2) (~45 min)

Find every test that asserts on elapsed time or a time ratio:
`rg -n "performance\.now|Date\.now\(\)|hrtime|ratio" test --glob '*.test.ts'`
and the "linear-time" test (ratio < 10) and the snapshot test that timed out
at 5,004 ms (see `.audit/audit/findings.md` line ~264 in the
`ginko-content-1.0` worktree).

- A linear-time assertion becomes an operation count: instrument the function
  with a counter (a spy on the inner step) and assert the count grows linearly
  (count(2n) ≤ 2 × count(n) + constant).
- A test that needs more than 5 s because of input size gets a smaller input
  that still exercises the same branch, not a longer timeout.

**Done when:** `rg -n "performance\.now|hrtime" test` returns only harness
code (no assertions); the full `pnpm test` passes 3 times in a row under
`--maxWorkers=100%`.

### 10.3 Comark snapshot → literal assertions (F-03) (~60 min)

`test/contracts/__snapshots__/comark-conformance-contracts.test.ts.snap`
(2,268 lines). For each snapshot entry, decide:

- the snapshot **is** the spec (a conformance corpus that must not change
  without review) → keep it, but split it into one `.snap` per syntax area so
  diffs are readable;
- otherwise → replace with a literal `toEqual` on the 1–3 fields that matter
  (tag, props, text), or delete when another test covers the same syntax.

Write the decision per entry group into `log.md`.

**Done when:** no snapshot file over 500 lines; the test file passes.

### 10.4 One built fixture per delivery mode in e2e (F-05) (~90 min)

`test/e2e/agent-markdown-negotiation.test.ts` takes 140 s (40 % of e2e),
`search-matrix` 79 s, `sitemap-static` 50 s; each builds its own Nuxt fixture.

- Build each delivery mode once per e2e run (static generate, Node runtime)
  in a Vitest `globalSetup` (`test/e2e/global-setup.ts`), keyed by fixture
  directory, and share the output path through `provide`/`inject`.
- `agent-markdown-negotiation`: run its request matrix against one running
  server per mode (table of `{ path, accept, expectStatus, expectType }`).
- Keep every assertion; only remove duplicated builds.

**Done when:** `pnpm test:e2e:prepared` passes and its wall time is ≤ 60 % of
the 10.1 baseline (log both).

### 10.5 Release tooling: keep what earns its place (decision 11, F-01, C-03) (~60 min + gate G2)

1. Publish workflow accepts a leading `v`: in `.github/workflows/publish.yml`
   strip one leading `v` from `inputs.version` in the first step and use the
   stripped value everywhere (`RELEASE_VERSION`). Update
   `scripts/test-release-workflow.mjs` to cover `v1.2.3` and `1.2.3`.
2. For each of these files, collect the evidence:
   `scripts/test-release-recovery.mjs`, `scripts/test-npm-recovery.mjs`,
   `scripts/verify-npm-recovery.mjs`, `scripts/sigstore-verifier/` (vendored
   verifier + lockfile), `scripts/check-repo-policies.mjs`,
   `scripts/docs-drift.mjs`.
   Evidence per file: `git log --format='%h %ad %s' --date=short -- <file>`,
   and every CI run or commit message where it failed and caught a real
   problem (`gh run list --workflow ci.yml --json ...` + search failed job
   logs for the script name over the last 90 days).
3. Write a table into `questions.md` (gate **G2**): file, lines, what it
   guards, last real catch (or "none found"), Codex's recommendation (keep /
   delete / merge into X). Recommend delete for each file with no real catch,
   except `docs-drift` and `check-repo-policies` if they caught something.
4. **Wait for Matthias's answer before deleting anything.** Continue with 10.6
   meanwhile. After approval, delete exactly the approved files, remove their
   `package.json` scripts and CI steps, and run `pnpm verify`.

**Done when:** `v` prefix works (test passes); G2 table written; after G2, the
approved deletions are merged.

### 10.6 Tested ranges in CI (criterion 9) (~45 min)

`ci.yml` has a minimum-runtime lane (main/dispatch only). Make the matrix
explicit and documented:

| Dimension | Lowest | Highest |
|---|---|---|
| Node | the lowest of `engines` (`22.18.0`) | current LTS (`24.x`) and `26.x` |
| Nuxt | lowest supported (`4.5.2`, the peer range floor) | latest `4.x` on npm older than 24 h |
| Vue | from that Nuxt | from that Nuxt |

The lowest-Nuxt lane installs exactly the floor versions (pnpm `overrides` in
a temp copy, not in the committed lockfile). Write the ranges into
`docs/content/docs/7.resources/5.support-and-stability.md`.

**Done when:** a `workflow_dispatch` CI run passes both ends; URLs in `log.md`.

### 10.7 Area-by-area cut and coverage proof (~90 min)

Go through `test/` area by area (`unit`, `contracts`, `provider`, `runtime`,
`client`, `e2e`, top-level `test/*.test.ts`). In each area delete or merge:

- near-duplicate tests (same input class, same branch) → one table test;
- tests of removed code (provider surface, global agent registry, legacy
  heading ids) that steps 5–8 did not already delete;
- tests that assert framework or type-checker guarantees;
- one-use helpers and fixtures (`test/helpers`, `test/support`, `test/mock`)
  left without users (`rg` each export);
- `test/tmp-review/` (check its content and history first; delete if it is a
  leftover review scratch dir).

Move the four top-level files `test/ginko-*.test.ts` into the matching project
folder.

Then rerun 10.1's coverage command, save `coverage-after.json`, and compare
per file. **No source file may lose covered lines** unless the lines were
deleted from the source in steps 2–9. Every lost line gets a new or restored
test.

**Done when:** coverage diff shows no unexplained loss (write the diff summary
into `log.md`); test line count and `pnpm test:prepared` time are logged next
to the baseline.

### 10.8 PR CI time (criterion 8) (~20 min)

After the PR is merged, take the last 10 `ci.yml` runs on PRs into
`release/1.0` (`gh run list --workflow ci.yml --limit 30 --json ...`) and
compute the median wall time. Target ≤ 10 min. If above, list the 3 slowest
jobs and their slowest steps in `log.md` and fix the largest cause if it is a
test the step owns.

**Done when:** median ≤ 10 min logged, or the cause is logged and in
`questions.md`.

## Step verification

```bash
pnpm verify
pnpm test:e2e
```

No demo run needed.
