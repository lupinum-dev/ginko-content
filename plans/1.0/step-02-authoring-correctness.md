# Step 2: Authoring correctness at ingest

**Why:** Today one authoring mistake (a relative link, one rejected prop) makes
the page renderer throw, and `nuxt generate` fails for the whole site with
"Public Markdown AST is not render-safe" and no file name. Normal authoring
patterns (relative `.md` links, Japanese file names, GitHub-style heading
anchors) break. Authors must learn about every problem at build time, all at
once, with file and line, and the page must never crash.

**Closes:** C-11, E-A004, C-12, C-17, E-A005, A-14, E-A013, C-19, C-34, D-02,
D-03, C-29, D-06, C-16. Decisions 7 and 8.

**Branch:** `step/02-authoring-correctness`. **Estimate:** ~8 h.

## Target design

```
file ──parse──► AST ──normalize links──► validate (schema, JSON purity,
                                          render policy, links)
                                               │ every problem → finding
                                               ▼ {severity, file, line, code, message, suggestion}
                                         validation report  ──► validation: 'error' fails build with the full list
renderer: validates the tree it gets; an unsafe node is skipped (dev: one console.warn), never throws
```

## Tasks

### 2.1 Render-safety findings at ingest (decision 8) (~90 min)

**Files:** `src/integrations/nitro/build.ts` (`createValidationReport`),
`src/features/validation/report.ts`, `src/cms-contract/render-policy.ts`
(`validatePublicMarkdownAst`), `src/runtime/server/api/cache.ts`.

1. Extend `ContentValidationFinding` with two optional fields and bump the
   report version (persisted artifact; no external users, so no migration):

   ```ts
   export const CONTENT_VALIDATION_REPORT_VERSION = 2 as const
   export interface ContentValidationFinding {
     severity: 'error' | 'info'
     file: string
     line?: number          // 1-based, present when the source line is known
     code?: string          // e.g. 'unsafe_url', 'unknown_component', 'relative_link_unresolved'
     message: string
     suggestion: string
   }
   ```

   Update `isContentValidationReport` to accept `line` (positive integer) and
   `code` (string) when present.
2. In `createValidationReport`, for every document of type `markdown`, run
   `validatePublicMarkdownAst(document.body, policy)` and, when present, on
   `document.excerpt`. `policy` is the resolved runtime render policy of the
   document's collection: the same object the module writes to
   `runtimeConfig.public.content.renderPolicies[collection]` (pass it into the
   Nitro context the same way `validationPublicAssets` is passed; do not
   rebuild it).
3. Each issue becomes one finding:
   `{ severity: 'error', file: document.file.path, code: issue.code, line, message: \`${issue.message} (at ${issue.path.join('.')})\`, suggestion }`.
   Suggestions per code:
   - `unsafe_url` → "Use a site-relative path (/docs/page), a relative .md file link, or an https URL."
   - `unknown_component` → "Declare the component in componentPolicy, or remove it."
   - `unknown_prop` / `missing_prop` / `invalid_prop_value` → "Match the component policy for <component>."
   - `unsafe_tag` → "Remove the HTML element or replace it with a declared component."
   - others → "See the render policy guide: /docs/guides/mdc-components."
4. **Line numbers:** AST nodes carry no positions. Compute `line` by reading the
   raw source (`sourceStorage(event).getItem(\`${source}:${path}\`)`) once per
   document with findings, and taking the first 1-based line that contains the
   offending value: for URL issues the URL string; for tag issues `<tag`; for
   component issues the component name. If nothing matches, omit `line`.
   Put this in one helper `locateSourceLine(source: string, needle: string): number | undefined` in `src/features/validation/source-line.ts`.
5. `pnpm exec ginko-content validate` (CLI, `src/cli/validate.ts`) prints
   `file:line  code  message` and the suggestion on the next line.

**Regression test:** `test/contracts/validation-render-safety.test.ts`: a
fixture with 3 files (`./x.md` link that cannot resolve, a `javascript:` link,
an unknown component) yields exactly 3 error findings with the right `file`,
`line` and `code`. Fails before: no such findings exist.

**Done when:** the test passes; `pnpm vitest run --project contracts-node test/contracts/validation-render-safety.test.ts`.

### 2.2 The renderer never throws for content (decision 8) (~45 min)

**File:** `src/runtime/app/components/internal/MarkdownRenderer.ts`.

Replace `assertPublicMarkdownAst(props.tree, props.renderPolicy)` with:

```ts
const result = validatePublicMarkdownAst(props.tree, props.renderPolicy)
const unsafe = result.ok ? EMPTY : new Set(result.issues.map(issue => nodePathKey(issue.path)))
if (!result.ok && import.meta.dev) warnOnce(props.dataContentId, result.issues)
```

`nodePathKey` reduces an issue path to the path of the **node** that holds the
problem (drop trailing `props`/`tag`/prop-name segments: the path up to the
last numeric `children` index). `renderNode` returns `null` for a node whose
path key is in `unsafe` (and so skips its subtree). Everything else renders.
`warnOnce` logs one `console.warn` per document id per page load with the
issue list. Production logs nothing.

Keep `assertPublicMarkdownAst` exported from `cms-contract` (CMS save paths
use it). Step 4 moves the validator to a browser-light module; do not do that
here.

**Regression test:** extend `test/client/` renderer tests (find the existing
MarkdownRenderer test file with `rg -l MarkdownRenderer test/client`): a tree
with one safe paragraph and one `<a href="javascript:x">` renders the paragraph
and no anchor, and does not throw. Fails before: throws
`PublicMarkdownValidationError`.

**Done when:** that test passes and the K001 known-failure fixture builds
(after 2.3) without a render exception.

### 2.3 Relative `.md` file links (E-A004, X002, K001) (~90 min)

**File:** `src/parsers/markdown.ts` (`normalizeLink`), reuse the `$` reference
links of `src/core/references/resolve.ts` (`CONTENT_REF_LINK_PREFIX = '$'`,
`parseRefLink`, `rewriteMarkdownRefLinks`).

Decided rule: a link whose path part ends in `.md` and has no scheme and no
leading `/` is a **file link**, resolved against the directory of the source
file:

| In `docs/start/index.md` | Resolves to source file | Public result |
|---|---|---|
| `./x.md` | `docs/start/x.md` | route of that document (`/docs/start/x`) |
| `x.md#setup` | `docs/start/x.md` | `/docs/start/x#setup` |
| `../section/y.md` | `docs/section/y.md` | `/docs/section/y` |
| `../../../outside.md` | escapes the source root | error finding `relative_link_outside_source` |
| `./missing.md` | no document | error finding `relative_link_unresolved` |

Implementation:

1. At parse, compute the target source path with `posix.normalize(posix.join(dirname(fileRelativePath), linkPath))`.
   The parser gets `id` (`<source>:<relative path>`); split it once.
2. Rewrite `href` to a `$` reference link to the target document, using the
   reference value format that `resolveGraphReferenceTarget` in
   `src/core/content/graph.ts` resolves for that document (read the function;
   use the same value it would accept for an authored reference to the target
   file). Keep the hash.
3. The existing query-time reference resolution then produces the localized
   public route through `resolvedRefs`, so mounted routes, translated slugs and
   locale prefixes work without new code.
4. A link that escapes the source root is not rewritten. The parser keeps the
   authored `href`, and `src/features/validation/links.ts` reports it as
   `relative_link_outside_source` (detect: no scheme, ends in `.md`, contains
   `..` beyond the root). An unresolved rewritten `$` ref is reported by the
   existing unresolved-reference check; give that finding
   `code: 'relative_link_unresolved'` when the ref came from a file link, and a
   message naming the target file path (`docs/start/missing.md`). Use `line`
   from task 2.1's helper with the file name as the needle.

If the reference value format cannot address a file in another collection,
stop with S2 and describe what is missing.

**Regression tests:** `test/unit/markdown-relative-links.test.ts` with the 5
table rows above (parse level: the rewritten `href`); one contracts test that a
built fixture resolves `./x.md` to `/docs/start/x` with a `route: '/docs'`
mount. Both fail before.

**Done when:** tests pass; demos: K001 builds and its links reach the pages;
X002 passes.

### 2.4 Security plugin keeps boolean `false` props (C-12, K002) (~45 min)

`comark/plugins/security` strips `:enabled="false"`, then the policy reports
`missing_prop "enabled"`. Find where the prop disappears (run the K002 fixture
source through `parseComark` with and without the security plugin and diff the
AST). Fix in Ginko's normalization (`src/core/markdown/normalize-comark.ts`)
or in the plugin options Ginko passes (`src/module/markdown-plugin-templates.ts`).
Do not patch Comark. If the cause is a Comark bug that Ginko cannot work
around, write the minimal reproduction into `questions.md` and file nothing
upstream yourself.

**Regression test:** `test/unit/markdown-security-plugin.test.ts`: with
`security` enabled, `::toggle{:enabled="false"}` keeps `enabled: false`. Fails before.

**Done when:** test passes; demos K002 builds.

### 2.5 HTML comments never render as text (C-17) (~20 min)

`<ContentRendererInline>` shows an authored `<!-- note -->` literally. Drop
comment nodes in `normalizeComarkNodes` (`src/core/markdown/normalize-comark.ts`)
for every parse path (page bodies, excerpts, inline). Comments are never part
of the public AST.

**Regression test:** unit test: `parseComark('a <!-- x --> b')` normalized has
no node or text containing `<!--`. Fails before.

**Done when:** test passes; demos C357 passes.

### 2.6 GitHub-compatible heading IDs (decision 7, A-14) (~90 min)

Start from branch `wip/heading-anchors` (step 0.3): rebase or cherry-pick its
commit onto `step/02-authoring-correctness`, then change it to the decided
scheme. The WIP keeps the `_` prefix, keeps parent prefixes for h3+, and adds
legacy alias logic; all three go.

Decided scheme (same as GitHub's `github-slugger`):

```ts
export function slugifyHeading(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')   // keep letters, marks, numbers, _, -, space
    .replace(/ /g, '-')
}
```

- Flat document scope: no parent prefix at any level.
- No `_` prefix for a leading digit: `## 1. Create the deployment` → `1-create-the-deployment`.
- Duplicates: first `x`, then `x-1`, `x-2` (counter per base slug, whole document).
- An empty slug (emoji-only heading) becomes `heading`, then the duplicate rule applies.
- An explicit authored id (`## Title {#custom}`) wins and is reserved before generated ids are allocated, so no generated id equals it.
- No legacy aliases. Delete `legacyHeadingIds`, `HeadingAnchor.aliases` and all alias rendering.
- IDs are assigned **once at parse** (`parse-comark.ts`, and the CMS parse in
  `cms-contract/mdc.ts`) and stored in `props.id`. The renderer and
  `toc.ts` read `props.id`; they never compute ids. Delete
  `resolveHeadingAnchors`/`headingAnchors` usage from `MarkdownRenderer.ts`
  (this also keeps slug code out of the browser bundle, step 4).

Table test (literal values, extend `test/unit/heading-anchors.test.ts`):

| Headings in order | IDs |
|---|---|
| `Intro`, `Intro`, `Intro` | `intro`, `intro-1`, `intro-2` |
| `1. Create the deployment` | `1-create-the-deployment` |
| `## API` then `### Options` | `api`, `options` |
| `Größe & Gewicht` | `größe--gewicht` |
| `日本語の見出し` | `日本語の見出し` |
| `🚀` , `🚀` | `heading`, `heading-1` |
| `Setup {#install}`, `Install` | `install`, `install-1` |
| `C++ / C#` | `c--c` |

**Done when:** table test passes; `test/unit/mdc-roundtrip.test.ts` passes
(update its expected ids to the new scheme; that is a named test change);
`pnpm test` passes.

**Docs:** `docs/content/docs/4.guides/2.mdc-components.md` and
`5.reference/3.module-options.md`: one short section "Heading IDs" with the
rule and 3 examples. CHANGELOG Breaking: "Heading ids follow GitHub: no `_`
prefix, no parent prefix. Update in-page links that used the old form."

### 2.7 Heading anchor links render (C-16) (~30 min)

`markdown.anchorLinks` (default `{ depth: 4, exclude: [1] }`) is documented but
no `<a>` is rendered. Decided markup: for a heading whose level is within
`depth` and not in `exclude`, the renderer outputs
`<h2 id="x"><a href="#x">…children…</a></h2>`. Implement in the renderer where
heading tags render, reading the option from `runtimeConfig.public.content.markdown`
(add `anchorLinks` to the `Pick` in `src/module/augmentations.ts` and to the
public runtime config writer). `anchorLinks: false` renders no anchors.

**Regression test:** client test: default options render an anchor inside h2,
none inside h1. Fails before.

**Done when:** test passes; demos C046 passes.

### 2.8 Unicode file slugs and collisions (E-A013, C-19, K101) (~60 min)

**File:** `src/core/content/slug.ts` (`slugifyUrlSegment`).

Decided rule:

1. Lower-case (when `lower`), apply the existing transliteration table and
   symbol words (`&` → `and`, …) as today.
2. Remove combining marks only after a Latin letter:
   `s.normalize('NFD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC')`.
3. Replace every run of characters outside `[\p{L}\p{M}\p{N}]` with `-`; trim
   and collapse hyphens.

| Input | Output |
|---|---|
| `Über uns` | `ueber-uns` |
| `Café Crème` | `cafe-creme` |
| `紹介` | `紹介` |
| `مرحبا بك` | `مرحبا-بك` |
| `नमस्ते` | `नमस्ते` |
| `Привет мир` | `привет-мир` |
| `🚀` | `` (empty) |

An empty slug for a file name is a build error:
`INVALID_SLUG: "<file>" has no letters or digits in its name. Rename the file.`
Two documents with the same collection, locale and path are a build error that
names **both** files (check where `buildContentGraph` or
`validateContentGraph` detects duplicate paths; make the message list both
files).

**Regression tests:** table test for `slugifyUrlSegment`; a contracts test
with `紹介.md` and `概要.md` in one collection builds two routes; a test with
`a.md` and `A.md` (or two files mapping to one slug) fails with both names.

**Done when:** tests pass; demos K101 passes in the multilingual demo (move
the fixture into the app), live check that `/ja/紹介` returns 200.

### 2.9 Strict JSON (E-A005, X205) (~15 min)

`src/parsers/json.ts` uses `destr`, which turns malformed JSON into an empty
object. Use `JSON.parse` for `.json`; a parse error throws `PARSE_FAILED`
naming the file (the `parseSource` wrapper in `integrations/nitro/ingest.ts`
already wraps). Remove `destr` from `dependencies` if no other import remains
(`rg "from 'destr'" packages/content/src`).

**Regression test:** unit: `{"title": }` throws with the file id in the error. Fails before.

**Done when:** test passes; demos X205 passes.

### 2.10 Schema and query boundary errors (C-34) (~45 min)

Three precise errors (find each code path from the demo check; the blog demo
results name the reproductions):

- C014: a reference field without a target collection fails setup with
  `Collection "<c>" field "<f>": reference() needs a target collection, e.g. reference('authors').`
- C028: a required `fields.json()` rejects `undefined` like other required fields.
- C112: `navigation()` with `populate` throws
  `navigation() does not support populate. Query the documents with many() instead.`
  in both the client and server query validation.

**Regression tests:** one test per error (unit or contracts, wherever the
nearest existing test for that validator lives). Each fails before.

**Done when:** tests pass; demos C014, C028, C112 pass.

### 2.11 CMS contract fixes (D-02, D-03, C-29, D-06) (~60 min)

**File:** `src/cms-contract/build.ts`.

- D-02: `fieldsFromSchema` filters `title`, `description`, `body`, `bodyMdc`
  for every collection. Filter them only for `page` collections. For `data`
  collections filter only `bodyMdc`.
- D-03: building a contract for an app without i18n fails with
  `CONTRACT_INVALID` because no default locale reaches the builder. When i18n
  is off, the module passes `defaultLocale: 'en'` and `locales: ['en']`
  (the same default the content runtime uses; confirm the runtime default in
  `src/module/options.ts` and use that constant, do not hard-code a second
  `'en'`).
- C-29: `cms.fields.<key>.label` is dropped by `mergeField`. Keep `label`.
- D-06: an invalid-document error names the failing field path
  (`fields.author.name: expected string`).

**Regression tests:** one contract test per item (extend
`test/contracts/cms-contract*.test.ts`). Each fails before.

**Done when:** tests pass; demos K301, K302, C013 pass in custom-source.

## Step verification

```bash
pnpm verify
```

Demos: rebuild all six with the new tarball. Must pass: X002, K001 (moved into
docs-site), K002, C357, C046, K101 (moved into multilingual), X205, C014,
C028, C112, K301, K302, C013. Deploy docs-site, multilingual, blog,
custom-source.

**Docs to update:** `4.guides/2.mdc-components.md` (heading ids, render
safety at build, relative links), `4.guides/6.routes-links-and-redirects.md`
(relative file links table), `7.resources/3.troubleshooting.md` (how to read
the validation report), `5.reference/3.module-options.md` (`validation`,
`anchorLinks`).
