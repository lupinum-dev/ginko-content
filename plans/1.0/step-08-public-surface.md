# Step 8: Public surface and page API

**Why:** The package has 21 entry points and 273 exported names that no doc
mentions. Under semver each one is a promise. The architecture doc lists 15
entry points, the export map has 21. Four agent entry points offer two ways to
register serializers, one through a mutable module-level registry. Every
catch-all page repeats ~12 lines of boilerplate (page key, 404 branch, error
rethrow), and a language switch in a shared header needs an expert pattern.

**Closes:** A-02, A-03, A-04, A-05, A-06, A-09, A-10, A-11, A-13, G-01, G-03.
Decisions 2, 4, 5 (conditional), 6.

**Branch:** `step/08-public-surface`. **Estimate:** ~8 h.

## Target export map (decided)

| Entry point | Stability | Contents |
|---|---|---|
| `.` | stable | Nuxt module default export, module option types |
| `./config` | stable | `defineContentConfig`, `defineCollection`, field helpers, `reference`, `defineTransformer` (moved from `./transformers`), config option types |
| `./client` | stable | query functions, `useContentPage`, `useContentLocalePath`, search composables, navigation helpers for the browser, agent path helpers (`agentRawPathForRoute`, `agentMarkdownPathForRoute`, `normalizeAgentRoutePath`, moved from `./agent-paths`) |
| `./server` | stable | server query API |
| `./navigation` | stable | navigation tree helpers |
| `./data-source` | stable | `defineContentDataSource` and the contract (step 5) |
| `./testing/data-source-contract` | stable | conformance kit, memory source |
| `./body-renderer` | stable | `ContentBodyRenderer` Vue component (ships as SFC from `dist/runtime`, the one export that does not go through `src/public/`) |
| `./agent` | stable, server-only | `defineAgentMarkdown`, serializer helpers, `renderAgentMarkdownPage`, `renderLlmsTxt`, `renderLlmsFullTxt`, `createAgentMarkdownRegistry` |
| `./agent-docs` | stable | packaged agent docs file |
| `./cms-contract` | integration | names Ginko packages import (see 8.3) |
| `./cms-contract/node` | integration | contract reader |
| `./portability` | integration | names Ginko packages import |
| `./portability/node` | integration | filesystem/portable directory IO |
| `./testing/portability-contract` | integration | portability conformance kit |

Removed: `./provider`, `./testing/provider-contract`, `./testing/provider-fixture`
(step 5), `./agent-registry`, `./agent-paths`, `./transformers`.

"Integration" means: for Ginko's own packages (ginko-cms, ginko-editor,
ginko-docs, ginko-kit, ginko-write). It follows semver for removals, but a
minor release may add required fields to integration types. Task 8.7 writes
this rule down.

## Tasks

### 8.1 Agent: one entry point, declarative registration (decision 2, A-04) (~90 min)

Decided API:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  content: { agent: { markdown: { serializers: '~~/server/agent-markdown' } } },
})

// server/agent-markdown.ts
import { defineAgentMarkdown, xmlComponentMarkdown } from '@lupinum/ginko-content/agent'
export default defineAgentMarkdown({
  components: { 'release-status': { /* AgentMarkdownComponent */ } },
  serializers: { 'api-explorer': (node, context) => '…' },
})
```

1. `defineAgentMarkdown({ components?, serializers? })` returns the object
   unchanged (typed identity helper).
2. The module adds a virtual module that imports the configured file (like
   `#content/virtual/sources` in step 5) and the runtime builds **one**
   registry with `createAgentMarkdownRegistry()` from it at first use. Option
   path: `agent.markdown.serializers` (string path, resolved with the Nuxt
   resolver; missing file fails the build with the path in the message).
3. Delete `src/runtime/server/agent-registry.ts` and the functions
   `registerAgentMarkdownSerializer(s)`, `registerAgentMarkdownComponent(s)`,
   `clearAgentMarkdownSerializers`, `getAgentMarkdownRegistry`.
4. `./agent` exports only the names in the table above plus the helper
   functions already in `src/public/agent.ts` (`blockquoteMarkdown`,
   `defineAgentMarkdownComponent`, `getMarkdownProp`, `jsonFenceMarkdown`,
   `linkMarkdown`, `renderMarkdownChildren`, `xmlComponentMarkdown`,
   `renderAgentMarkdownFrontmatter`) and their types.
5. Path helpers move to `./client`. Delete `src/public/agent-registry.ts`,
   `src/public/agent-paths.ts`, their `exports` entries.

**Tests:** runtime test: a configured serializer file changes the Markdown
output of its component; two Nitro app instances in one test process do not
share registrations (create two runtimes with different files). Package
export test: removed entry points fail to resolve.

**Done when:** tests pass; `pnpm typecheck` passes.

### 8.2 Fold `./transformers` into `./config` (~20 min)

`defineTransformer` is exported from `./config`. Delete the `./transformers`
export and update `examples/advanced/transformer`.

**Done when:** `pnpm examples:build` passes.

### 8.3 Shrink the integration surface to real use (decision 2, G-01, A-05) (~90 min)

1. Write `scripts/integration-imports.mjs` (one-off, keep it in `scripts/`
   because step 12 reruns it): for each consumer checkout and branch below,
   collect every named import from `@lupinum/ginko-content/<entry>`
   (TypeScript AST via `typescript` from the workspace, not regex), output JSON
   `{ entry: { name: [repo:file, …] } }`.

   | Repo path | Branch |
   |---|---|
   | `/Users/matthias/Git/0_libs/ginko-cms` | `codex/cms-overnight-integration` |
   | `/Users/matthias/Git/0_libs/ginko-editor` | `feat/kit-v2` |
   | `/Users/matthias/Git/0_libs/ginko-docs` | `feat/one-shell-01-public-seams` |
   | `/Users/matthias/Git/0_libs/ginko-kit` | its current default branch |
   | `/Users/matthias/Git/0_libs/ginko-write` | its current default branch |

   Read files with `git show <branch>:<path>` and `git ls-tree -r`; do not
   switch branches in those checkouts.
2. For `./cms-contract`, `./cms-contract/node`, `./portability`,
   `./portability/node`: keep exactly the names used by a consumer **or**
   named in a docs page under `docs/content/docs/`. Remove every other export
   from the entry file (the code stays where other modules use it).
3. A-05: `./portability` stops re-exporting `canonicalJsonBytes`,
   `hashCanonicalJson`, `sha256Hex`, `IncrementalSha256`,
   `verifyPublicImageBytes`; they are exported only from `./cms-contract`. If a
   consumer imports one of them from `./portability`, list the file in
   `log.md`; step 12 updates that consumer.
4. Write the before/after name counts per entry into `log.md`.

**Done when:** the JSON is in `log.md` (or `plans/1.0/integration-imports.json`);
`pnpm test` and `pnpm typecheck` pass; `pnpm api-docs:generate` regenerated.

### 8.4 Page API defaults (decision 4, A-09, A-11) (~90 min)

Decided API:

```vue
<!-- pages/docs/[...slug].vue: the whole page -->
<script setup lang="ts">
const { page } = await useContentPage('docs')
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
```

- New option `notFound?: 'throw' | 'return'`, default `'throw'`.
- With `'throw'`: when the first load settles as not-found, throw
  `createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })`
  from the composable (SSR and first client load). When a later client
  navigation settles as not-found, call `showError` with the same error. On
  `status === 'error'`, rethrow the underlying error the same way (keep its
  `statusCode`; default 500).
- With `'return'`: today's behavior (status `'not-found'`, no throw).
- `definePageMeta({ key: route => route.path })` is no longer needed. Verify
  with a browser e2e: navigate between two pages of one catch-all route with
  no `key`; the content and title update, no stale content shows. If it does
  not work without the key, stop with S3 and report what breaks.
- Remove the "does not throw a default 404" paragraph from the composable doc
  comment and write the new contract.

**Tests:** client tests for both options (not-found throws 404 by default;
`'return'` gives status `'not-found'`; error rethrows with status code);
browser e2e for keyless navigation. All fail before.

**Done when:** tests pass; quickstart fixture, examples, docs and the six demos
use the 5-line page (update every catch-all page: `rg -l "useContentPage" docs examples playground test/fixtures ../ginko-content-demos/apps`).

### 8.5 Language switch in any header (decision 5, conditional, A-10) (~90 min)

First prove it in the multilingual demo on a branch:

1. In `useContentPage`, when `@nuxtjs/i18n` is installed and the page has
   alternates, call `useSetI18nParams` with the route params for every
   alternate locale (derive the param name and value from the current matched
   route record, e.g. `slug: ['guide', 'start']` for `[...slug]`).
2. In the demo, replace the shared-header recipe (layout `false`, page result
   passed as prop, `useContentLocalePath(..., { fallback })`) with the default
   layout calling only `useSwitchLocalePath()`.
3. Check: SSR HTML of `/de/anleitung/einstieg` has a header link to the English
   translated slug and the Japanese one; the same after client navigation
   between two pages; for all 3 locales.

**If all checks pass:** keep the change, document it as the default recipe,
and keep `useContentLocalePath` as the advanced tool. **If any check fails:**
revert the composable change, keep today's recipe, improve its docs page, and
write the failing case into `log.md`. Either way, record the outcome in
`findings.md` A-10.

**Done when:** one of the two outcomes is complete and the multilingual demo
checks X10x and the C16x/C18x i18n checks pass.

### 8.6 Types the docs name exist (G-03, A-13) (~30 min)

- Docs say `UseContentPageResult`; the export is `UseContentPageReturn`. Fix
  the docs.
- Export from `./config` (as types) every option type the module-options
  reference names: `ContentSearchOptions`, `ContentI18nOptions`, and the
  others listed in G-03 (`rg -n "\`Content[A-Za-z]*Options\`" docs/content/docs`
  gives the list). If a named type does not exist as a type at all, create it
  from the existing inline type, do not invent fields.
- A-13: the module option `componentPolicy` is typed and documented as V2 only
  (`PortableComponentPolicyV2`). Parsing V1 input stays internal (stored CMS
  contracts may be V1). Remove `PortableComponentPolicyV1` from public exports
  unless 8.3's import scan shows a consumer uses it; then keep it in
  `./cms-contract` only.

**Done when:** `pnpm docs-drift` and `pnpm typecheck` pass.

### 8.7 Write the surface down (A-02, A-03, A-06) (~45 min)

- `meta/ARCHITECTURE.md` "Public Surface" lists exactly the 15 entry points of
  the table above, with stability class, and the one `dist/runtime` export
  (`./body-renderer`) with its reason.
- `docs/content/docs/5.reference/11.package-exports.md` matches the table.
- `docs/content/docs/7.resources/5.support-and-stability.md`: semver rules for
  stable entries; the integration rule (above); deprecation policy (a removal
  needs one minor release with a runtime warning, except security fixes);
  tested ranges (filled in step 10.6).
- `pnpm api-docs:generate`, commit the generated report. From now on
  `pnpm api-docs:check` in CI is the frozen API report.

**Regression test:** package contract test: `Object.keys(exports)` equals the
15-entry list (literal array). Fails before.

**Done when:** test passes; `pnpm lint` (includes `api-docs:check`) passes.

## Step verification

```bash
pnpm verify
pnpm release:pack && pnpm test:package-consumer && pnpm test:package-consumer:npm
```

Demos: all six on the new tarball with the 5-line page; multilingual per 8.5.
All previously passing checks still pass. Deploy all six.

**Docs:** quickstart (5-line page), `5.reference/5.composables.md`
(`notFound`, i18n header recipe per 8.5), `4.guides/12.agent-readable-output.md`
(declarative serializers), `5.reference/11.package-exports.md`,
`7.resources/5.support-and-stability.md`. CHANGELOG Breaking entries for every
removed entry point and for the 404 default, each with the replacement.
