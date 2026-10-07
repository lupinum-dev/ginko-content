# Step 12: Consumers on the RC, RC release, final sweep

**Why:** 1.0 claims the Ginko packages run on it without workarounds. Today
ginko-cms pins beta.4, ginko-docs beta.9, ginko-editor beta.10, and the real
consumer code lives on unmerged integration branches. ginko-cms could not even
be checked because its build needs a packed ginko-editor that does not exist.

**Closes:** B-01, B-05, B-06, B-07. Criteria 2, 6, 10. Decision 12.

**Estimate:** ~6 h + gates G3, G4, G5.

## Tasks

### 12.1 Pack the release candidate (~20 min)

On `release/1.0` head (all steps merged):

```bash
pnpm run release:prepare -r 1.0.0-rc.1     # version + CHANGELOG; review the diff
git switch -c step/12-rc-1 && git commit -am "chore(release): v1.0.0-rc.1" && git push -u origin step/12-rc-1
gh pr create --base release/1.0 ...       # merge after CI
pnpm build:packages && pnpm release:pack
```

Copy the tarball to `ginko-content-demos/vendor/` as
`lupinum-ginko-content-1.0.0-rc.1-<sha>.tgz` and run the full demo loop
(README) for all six demos: every check at both viewports.

**Done when:** `pnpm run release:verify` passes locally once on the RC commit
(this is the one time the full release gate runs locally); all demo checks
pass or are mapped per step 11.2.

### 12.2 Migrate each consumer on a branch (decision 12) (~3 h)

For each consumer, work in a **new worktree** of that repo, on a new branch
from its integration branch. Never switch branches in Matthias's checkouts.

| Repo | Base branch | New branch |
|---|---|---|
| ginko-editor | `feat/kit-v2` | `chore/ginko-content-rc` |
| ginko-cms | `codex/cms-overnight-integration` | `chore/ginko-content-rc` |
| ginko-docs | `feat/one-shell-01-public-seams` | `chore/ginko-content-rc` |
| ginko-kit | default branch | `chore/ginko-content-rc` |
| ginko-write | default branch | `chore/ginko-content-rc` |

In each:

1. Point `@lupinum/ginko-content` at the RC tarball (`file:` path; copy the
   tarball into the repo's `vendor/` if its CI must install it).
2. Apply the migration guide (step 11.4) and nothing else. Use
   `scripts/integration-imports.mjs` (step 8.3) to find every import to change.
3. Remove every `as unknown as` cast against a Ginko type
   (`rg -n "as unknown as" --glob '*.ts'` near Ginko imports) when the RC type
   now fits (B-03, B-04). A cast that is still needed is a finding: write it
   into `questions.md` with file:line.
4. Fix heading anchors in authored content to the step 2.6 scheme (ginko-kit
   had 3 broken anchors; ginko-docs authored links).
5. Run the repo's own build, typecheck and test commands (read its
   `package.json`/`AGENTS.md`).
6. ginko-cms needs a packed ginko-editor: pack ginko-editor from its
   `chore/ginko-content-rc` branch (its own pack command) and point ginko-cms at
   that tarball. This closes the B-07 gap.
7. Push the branch and open a PR **into the base branch** (not `main`).

**Done when:** all five PRs are open with green CI (or with a red check whose
cause is outside the migration, written into the PR and `questions.md`); the
migration diff size per repo is in `log.md`. Gate **G5**: Matthias merges the
integration branches into each `main`.

### 12.3 Consumer gate summary (~20 min)

Rerun `scripts/integration-imports.mjs` against the five
`chore/ginko-content-rc` branches. Confirm: no import from a removed entry
point, no deep import (`@lupinum/ginko-content/dist/...`), no removed name.

**Done when:** the summary table is in `log.md`.

### 12.4 Pull request `release/1.0` → `main` (gate G3) (~30 min)

Open the PR `release/1.0` → `main`. Body: the criteria table from README with
the evidence link for each row (log entries, CI runs, demo results, Lighthouse,
budgets), the list of step PRs, and the open items in `questions.md`. Do not
merge. Gate **G3**: Matthias reviews and merges.

### 12.5 Publish the RC (gate G4) (~0 min for Codex)

Gate **G4**: Matthias runs the protected `Publish` workflow with version
`1.0.0-rc.1` on `main` and approves the `npm` environment. Codex does not
trigger it.

After npm shows `1.0.0-rc.1` under the `next` tag and is older than the
24-hour `minimumReleaseAge` (or the demos repo has no age policy):

```bash
cd ../ginko-content-demos && corepack pnpm use-ginko 1.0.0-rc.1
```

Rebuild, deploy and check all six demos from the npm package. Switch each
consumer branch from the tarball to `1.0.0-rc.1`.

**Done when:** all demo checks pass from the npm package; consumer branches
build from npm.

### 12.6 Final readiness report (~45 min)

Write `plans/1.0/report.md`: the 10 criteria with status and evidence link
each; budgets with measured numbers (first-page JS per demo before/after,
static generate 200/1,000/2,000, search and SSR latency on scale, Lighthouse);
the findings register summary (fixed / after 1.0 / dropped counts); anything
in `questions.md` still open. Open it as a PR into `main` after G3.

The `1.0.0` final release is Matthias's decision after the RC has run in the
consumers; it uses the same protected workflow.

**Done when:** `report.md` is merged or in an open PR.
