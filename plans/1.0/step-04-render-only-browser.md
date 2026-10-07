# Step 4: Render-only browser path

**Why:** A Ginko page ships ~231 kB gzip of JS where bare Nuxt ships 56.7 kB.
About 75 % of the extra is parser and validation code the page never runs:
Comark, markdown-exit, htmlparser2, two copies of `entities`, Zod, js-yaml.
Four independent import paths pull it in, so all four must be cut together
(cutting one alone saves 288 B). Also, Markdown links between pages reload the
whole document instead of navigating client-side.

**Closes:** P-01, D-01, E-A014, C-08, A-08 (decision 3).

**Branch:** `step/04-render-only-browser`. **Estimate:** ~6 h.

## Already done before this step (step 0.2b, `feat/kit-v2`)

`027d98f` made `MarkdownRenderer.ts` and `runtime-render-policy.ts` import the
render policy and validation modules directly instead of the `cms-contract`
barrel, and added `test/unit/body-renderer-bundle-size.test.ts` (gzip budget
and forbidden-module guard for `body-renderer`). `79375f7` switched the
quickstart to collection names. Read both diffs first
(`git show 027d98f 79375f7`). For each task below: if the commit already
satisfies the "Done when", tick it with "done in 027d98f/79375f7" in
`log.md` and move on; otherwise finish only what is missing. Do not redo the
work in a different shape.

## The four import paths (measured in `.audit/bundle/report.md`)

| # | Path | Pulls in | Fix (task) |
|---|---|---|---|
| 1 | `MarkdownRenderer.ts` → `cms-contract/index` barrel → `provider-wire` (Zod) and `mdc` (Comark, YAML) | Zod, Comark, YAML, entities | 4.2 |
| 2 | `runtime-render-policy.ts` → `cms-contract/index` barrel + `hash` | same | 4.3 |
| 3 | page imports a collection handle from `content.config.ts` → `config` → Zod and every schema | Zod, schemas | 4.4 |
| 4 | globally registered `ContentRendererInline.vue` → `parse-comark` → Comark → htmlparser2 → entities | parser | 4.5 |

## Tasks

### 4.1 First-page JS measurement script (~45 min)

Create `scripts/measure-first-page-js.mjs`:

```
node scripts/measure-first-page-js.mjs --app test/fixtures/quickstart --route / [--json]
```

1. Runs `nuxt build <app>` (skip with `--no-build` if `.output` exists).
2. Starts `.output/server/index.mjs` on a free port, fetches the route's HTML.
3. Collects every JS URL from `<script src>` and `<link rel="modulepreload">`,
   reads each file from `.output/public`, gzips it (`zlib.gzipSync`, level 9),
   sums the bytes.
4. Prints `total=<bytes> files=<n>` and, with `--json`, a list per file and per
   npm package (package = path segment after the last `node_modules/`, or
   `ginko` for files from `@lupinum/ginko-content`; use the build's sourcemaps
   if present, otherwise report per file only).

Run it on `test/fixtures/quickstart` on `release/1.0` before any change and
write the baseline into `log.md`. Expect ~220–235 kB.

**Done when:** the script prints a total for the quickstart fixture and exits 0.

### 4.2 Renderer imports only browser-light modules (~60 min)

1. Create `src/core/markdown/render-policy.ts` and move into it, from
   `src/cms-contract/render-policy.ts`: the issue types,
   `PublicMarkdownValidationError`, `validatePublicMarkdownAst`,
   `assertPublicMarkdownAst`, `classifyPortableMarkdownElement`,
   `isSafePublicMarkdownUrl`, `isSafePublicLinkUrl`, and the private tables
   they use. It may import only from `src/core/**` and `src/types/**`.
2. `src/cms-contract/render-policy.ts` re-exports these names from the new
   module (the CMS integration surface keeps its names). Functions that need
   portable asset or V2-policy validation stay in `cms-contract`.
3. `MarkdownRenderer.ts` imports from `../../../../core/markdown/render-policy.js`
   and from `core/markdown/*` only. No import of `cms-contract/index` anywhere
   under `src/runtime/app/` (`rg "cms-contract" packages/content/src/runtime/app` must be empty, type-only imports from `cms-contract/types` are allowed).

**Regression test:** extend the existing `test/unit/architecture-boundaries.test.ts`
(it already parses imports with the TypeScript AST, but checks **direct**
imports only). Add a transitive walker: resolve relative specifiers to files
(`.ts`, `.js` → `.ts`, `.vue`, `/index.ts`), follow static imports and
re-exports, skip `import type` and `export type`. New test: starting from
`src/runtime/app/components/ContentRenderer.vue`, `ContentBodyRenderer.vue`
and every `src/runtime/app/composables/*.ts`, no reached file is
`src/cms-contract/index.ts`, under `src/parsers/`, or
`src/core/markdown/parse-comark.ts`, and no reached bare specifier is `zod`,
`js-yaml`, `comark`, `markdown-exit` or `htmlparser2`. Fails before. Step 9
turns the walker into the general rule table.

**Done when:** the test passes; `pnpm test` passes.

### 4.3 Runtime render policy: validated at build, restored in the browser (~45 min)

`src/runtime/app/utils/runtime-render-policy.ts` re-validates the policy in the
browser (`assertPortableComponentPolicyV2`, `canonicalJsonBytes` compare). The
module produced this policy at build time from validated input, so the browser
check is duplicate work and pulls the barrel.

- Move the built-in-contract equality check and `assertPortableComponentPolicyV2`
  to module setup in `src/module.ts`, right where `runtimeRenderPolicies` is
  built. A mismatch fails `nuxt build` with the same message as today.
- In the browser keep only `restoreRuntimeNull` (Nuxt turns nested `null` into
  `''` in public runtime config). The file then imports nothing from
  `cms-contract`.

**Regression test:** a module/contracts test that an invalid built-in override
in `componentPolicy` fails module setup with
`Invalid built-in render policy for "<tag>".` (move the existing runtime test
if there is one: `rg "Invalid built-in render policy" test`).

**Done when:** test passes; `rg "cms-contract" packages/content/src/runtime/app` empty.

### 4.4 App code names collections by string (decision 3, A-08) (~60 min)

String names are already typed through the generated
`GinkoContentCollectionMap` (`src/types/query-parts/collections.ts`) and
accepted at runtime (`src/features/query/handles.ts`).

Decided API:

- Client API (`@lupinum/ginko-content/client` and the auto-imports `one`,
  `many`, `count`, `paginate`, `backlinks`, `resolveOne`, `surround`,
  `navigation`, `useContentPage`, `useContentLocalePath`) accepts
  `ContentCollectionName` only. Change the parameter types from
  `ContentCollectionTarget` to `ContentCollectionName` (a string union when the
  app has generated types, `string` otherwise). `populate` and `backlinks`
  sources take names too.
- At runtime the client `ensureCollectionName` throws for a non-string:
  `TypeError: Pass the collection name, e.g. useContentPage('docs'). Collection handles belong in content.config.ts and server code.`
- Server API (`@lupinum/ginko-content/server`) accepts a name or a handle (no
  change).
- Update every example and doc page that imports a handle into a Vue file or
  composable: `rg -l "from '~/content.config'|from '~~/content.config'|from '../content.config'" docs examples test/fixtures playground`.
  Replace `useContentPage(docs)` with `useContentPage('docs')` and remove the
  import.

**Regression tests:**
- type test (`test/types/` or the typecheck fixture): `useContentPage('docs')`
  compiles; `useContentPage('nope')` is a type error when generated types exist
  (`// @ts-expect-error`).
- client test: passing an object throws the TypeError above.

**Done when:** tests pass; `pnpm typecheck` passes; `pnpm docs:build && pnpm examples:build` pass.

CHANGELOG Breaking: "Client query functions take collection names
(`useContentPage('docs')`). Remove `content.config` imports from pages and
components; they shipped Zod and every schema to the browser."

### 4.5 Inline renderer loads the parser lazily (~45 min)

`ContentRendererInline.vue` statically imports `parseComark`,
`normalizeComarkNodes`, `toMarkdownRoot`. Decided:

- On the server (`onServerPrefetch`) it parses as today; the tree goes to the
  payload through `useState`.
- In the browser it imports the parser only when it must parse: no tree in
  state, or `value`/`unwrap` changed. Use one module-level
  `let parserModule: Promise<typeof import('../../../core/markdown/inline-parse')>`
  and a new small file `src/core/markdown/inline-parse.ts` that exports
  `parseInlineMarkdown(value, unwrap)` (moves the three calls and `unwrapRoot`
  logic). `import()` it inside `refresh()`.
- The component stays globally registered.

**Regression test:** extend the 4.2 transitive test in `architecture-boundaries.test.ts`: `ContentRendererInline.vue`
has no **static** path to `parse-comark`; a dynamic `import()` of
`inline-parse` is allowed. Client test: after SSR hydration with state present,
the parser module is not imported (spy on the dynamic import via a module mock
of `inline-parse`).

**Done when:** tests pass.

### 4.6 One copy of `entities` (~20 min)

Ginko depends on `entities@^7` (`src/core/markdown/angle-components.ts`);
htmlparser2 brings `entities@8`. Check whether `decodeHTML` and
`escapeAttribute` behave the same in v8 for the inputs in
`test/**/angle*` tests. If yes, move Ginko to the v8 range htmlparser2 uses.
If behavior differs, keep v7 and write the difference into `log.md` (this is
server-only after 4.2–4.5, so it no longer affects the browser).

**Done when:** `pnpm why entities` shows one major, or `log.md` explains why two remain; `pnpm test` passes.

### 4.7 Markdown links navigate client-side (C-08, X001) (~45 min)

Add `src/runtime/app/components/Prose/ProseA.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { NuxtLink } from '#components'
const props = defineProps<{ href?: string, target?: string, rel?: string }>()
const internal = computed(() => !!props.href
  && props.href.startsWith('/') && !props.href.startsWith('//')
  && (!props.target || props.target === '_self')
  && !/\.[a-z0-9]{1,8}(?:[?#]|$)/i.test(props.href.split('#')[0]!))   // files like /files/a.pdf stay plain links
</script>
<template>
  <NuxtLink v-if="internal" :to="href"><slot /></NuxtLink>
  <a v-else :href="href" :target="target" :rel="rel"><slot /></a>
</template>
```

Register it like the other Prose components and add `a: 'ProseA'` to the
default `markdown.tags` map in `src/module/defaults.ts` (next to
`img: 'ProseImg'`, `pre: 'ProsePre'`). Follow `ProseImg.vue` for import style. Hash-only links
(`#section`) stay plain anchors. An app can override `ProseA` like any prose
component.

**Regression test:** client test: `[a](/guide)` renders a `RouterLink`/`NuxtLink`;
`[a](https://x.dev)` and `[a](/file.pdf)` render `<a>`. Browser e2e: extend the
nearest existing browser-e2e navigation test: clicking an in-content link keeps
a `window.__marker`. Fails before.

**Done when:** tests pass; demos X001 passes on quickstart and docs-site.

### 4.8 Measure and record (~15 min)

Run 4.1's script on the quickstart fixture. **Target: ≤ 85 kB gzip** (bare
Nuxt 56.7 kB + Ginko render code). If above 85 kB, use `--json` to find the
largest non-Vue package and stop with S3 if the remaining cause is not one of
the four paths.

Run the `editor-render` POC in `lupinum-dev/ginko-integration-pocs` against the
packed tarball: its failing "render-only bundle" test must pass (no parser,
Zod or YAML module in the Vite build of `body-renderer`).

**Done when:** quickstart ≤ 85 kB gzip logged; POC test passes.

## Step verification

```bash
pnpm verify
node scripts/measure-first-page-js.mjs --app test/fixtures/quickstart --route /
```

Demos: all six; record first-page JS per demo in `log.md` (quickstart was
221 kB, multilingual 272.7 kB, scale 265 kB, docs-site ~476 kB). Must pass:
X001. Every previously passing check still passes. Deploy all six.

**Docs:** every page and example uses string names in app code;
`5.reference/5.composables.md` and `4.query-api.md` say "collection name";
`5.reference/7.components.md` documents `ProseA` and how to override it.
