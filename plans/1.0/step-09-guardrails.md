# Step 9: Guardrails in CI (import boundaries and budgets)

**Why:** Steps 4–6 fix the architecture and the numbers. Without checks, one
convenient import brings the parser back into the browser, or one per-request
rebuild brings back quadratic builds. Criteria 3 and 4 need CI to enforce them.

**Closes:** criteria 3 and 4 (no finding ID).

**Branch:** `step/09-guardrails`. **Estimate:** ~4 h.

**Rule for every guard here:** deterministic. Sizes and operation counts, not
wall-clock timings, in PR CI. Timing ratios run only in the scheduled scale
workflow.

## Tasks

### 9.1 One import-boundary test (~60 min)

Turn `test/unit/architecture-boundaries.test.ts` (extended in steps 4.2, 4.5,
5.5) into one table-driven test, and fold in `test/unit/cms-contract-purity.test.ts`
and `test/unit/navigation-purity.test.ts`: move each of their import rules into
the table, keep any assertion that is not an import rule as its own test in
the same file, then delete the two files (named deletion). Table:

```ts
const rules = [
  { from: 'src/core/**', forbid: ['nuxt', '#imports', '#app', 'h3', 'nitropack', 'vue', 'src/runtime/**', 'src/module/**', 'src/integrations/**'] },
  { from: 'src/runtime/app/**', forbid: ['src/cms-contract/index.ts', 'src/parsers/**', 'src/storage/**', 'src/integrations/**', 'src/module/**', 'zod', 'js-yaml', 'comark', 'markdown-exit', 'htmlparser2'], allowDynamic: ['src/core/markdown/inline-parse.ts'] },
  { from: 'src/public/client.ts', forbid: [/* same as runtime/app */] },
  { from: 'src/features/**', forbid: ['nuxt', '#imports', 'h3', 'nitropack', 'src/runtime/**', 'src/module/**'] },
]
// plus: no import cycles in src/core/**, src/features/**, src/runtime/server/**
```

Rules are **transitive** for static imports (walk the graph), direct for
dynamic `import()`. Type-only imports (`import type`) are ignored. Each failure
prints the full chain `a.ts → b.ts → zod`.

If `src/features/**` violates its rule today, fix the import when it is a
one-line move; otherwise stop with S3 and list the chains.

**Done when:** test passes on `release/1.0`; it fails when you add
`import 'zod'` to `src/runtime/app/composables/runtime.ts` (try it, revert,
note it in `log.md`).

### 9.2 Bundle budgets (~60 min)

Create `budgets.json` at the repo root:

```json
{
  "firstPageJsGzip": { "test/fixtures/quickstart": { "route": "/", "max": 85000 } },
  "bodyRendererGzip": { "max": 25000 }
}
```

1. `scripts/check-budgets.mjs` runs `scripts/measure-first-page-js.mjs`
   (step 4.1) for each app entry and fails when a total exceeds `max`, printing
   the top 10 files.
2. Body renderer: `test/unit/body-renderer-bundle-size.test.ts` (from
   `027d98f`, step 0.2b) already guards the gzip size and forbidden modules.
   Read it; move its limit into `budgets.json` and keep the test. Only if it
   does not build a real Vite bundle, add `test/fixtures/body-renderer-vite/` (a plain Vite + Vue
   app that imports `@lupinum/ginko-content/body-renderer` and renders a fixed
   AST; copy the shape of `ginko-integration-pocs/editor-render`). The script
   builds it, sums gzip JS, and also fails if any output chunk contains the
   strings `markdown-exit`, `htmlparser2`, `ZodError` or `js-yaml` (module
   markers that survive minification; confirm each marker exists in a build
   from before step 4 so the check can fail).
3. Add `pnpm check:budgets` and run it in the existing `docs-examples` CI lane
   (it already builds apps). Do not add a new lane.

**Done when:** `pnpm check:budgets` passes; it fails when `max` is set to 1000
(try, revert, log).

### 9.3 Work-count guards (~30 min)

Keep the step 6 tests (source loads once during prerender; one MiniSearch per
process; agent middleware does not render) in the normal `test` lanes. Add one
for the graph: building the derived artifacts for N documents calls
`buildContentGraph` once per build (spy). These are the PR-time guard against
quadratic work.

**Done when:** the four tests run in `pnpm test` and pass.

### 9.4 Scheduled scale workflow (~60 min)

Add `.github/workflows/scale.yml`: `schedule` weekly and `workflow_dispatch`.
It generates synthetic content (reuse the generator from
`ginko-content-demos/checks/scale-*` by copying the generator function into
`scripts/scale-fixture.mjs`; do not depend on the demos repo), runs
`nuxt generate` at 1,000 and 2,000 documents, and fails when:

- either run exits non-zero or exceeds the runner's memory, or
- time(2,000) > 2.5 × time(1,000).

It uploads the timings as an artifact. Use the same pinned action SHAs as
`ci.yml` (`scripts/verify-action-shas.mjs` must pass).

**Done when:** a `workflow_dispatch` run on the step branch passes; its URL is
in `log.md`.

## Step verification

```bash
pnpm verify
pnpm check:budgets
```

No demo run needed.

**Docs:** `CONTRIBUTING.md`: a short "Guardrails" section: what each guard
protects and how to read a failure.
