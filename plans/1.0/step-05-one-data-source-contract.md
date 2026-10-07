# Step 5: One data-source contract

**Why:** There are two public extension contracts for one job. `ContentDataSource`
(`./data-source`) is the clean one: framework-free, bounded, abort signal and
deadline, cache hints. `ContentProvider` (`./provider`) is the H3-event
contract the module actually calls, and `bindContentProvider` (455 lines)
adapts one to the other. Both are public, each with its own cache-hint type,
error factory and contract kit. ginko-cms writes a `ContentDataSource` and
binds it by hand. Users should write one thing and register it.

**Closes:** A-01 (decision 1), A-07 (query, provider result, errors, cache
hints), E-A016, E-A008, C-30, C-28, B-03, D-05, D-04, C-27, B-04.

**Branch:** `step/05-one-data-source`. **Estimate:** ~8 h.

## Target design

```ts
// content.config.ts (app)
export default defineContentConfig({
  source: 'cms',                                   // was: provider
  sources: { cms: '~~/server/content-source' },    // was: providers
  collections: { docs },
})

// server/content-source.ts (app or integration module)
import { defineContentDataSource } from '@lupinum/ginko-content/data-source'

export default defineContentDataSource({
  name: 'cms',
  capabilities: {
    protocol: 'ginko-content-data-source/v1',
    query: { operators: ['$eq', '$in'], pagination: ['offset'], maxPageSize: 100 },
  },
  // The only place that sees the H3 event. Return verified facts only.
  async createContext(event) {
    return { tenantId: await verifiedTenant(event) }
  },
  async query(context, query, control) {
    return backend.query({ context, query, signal: control.signal })
  },
})

// An integration module (ginko-cms) registers its source by name:
nuxt.hook('content:sources', (sources) => { sources.cms = resolve('./runtime/content-source') })
```

- The module loads the registered module, checks it is a `ContentDataSource`,
  and binds it internally. Users never see `ContentProvider` or a binder.
- The filesystem source stays an internal implementation; nothing about it is public.
- Exactly one public cache-hint constructor (`createContentDataSourceCacheHint`),
  one public error factory (`createContentDataSourceError`), one conformance kit
  (`@lupinum/ginko-content/testing/data-source-contract`).

## Tasks

### 5.1 `defineContentDataSource` with `createContext` (~45 min)

**File:** `src/public/data-source.ts`.

- Add `createContext(event: H3Event): Context | Promise<Context>` as a
  **required** member of `ContentDataSource<Context>` (import the `H3Event`
  type from `h3`, a peer dependency since step 0).
- Add the identity helper for inference:

  ```ts
  export function defineContentDataSource<Context>(source: ContentDataSource<Context>): ContentDataSource<Context> {
    return source
  }
  ```
- Public names exported from `./data-source` must not contain `Provider`.
  Rename on the public export (keep internal names as they are):

  | Old public name | New public name |
  |---|---|
  | `BoundedContentProviderQuery` | `ContentDataSourceQuery` |
  | `ContentProviderRouteFact` | `ContentRouteFact` |
  | `ContentRouteRecord` | `ContentRouteRecord` (unchanged) |
  | `ProviderDocumentInput` | `ContentDataSourceDocument` |
  | `ContentProviderNavigationItem` | `ContentDataSourceNavigationItem` |
  | `ContentProviderSurroundItem` | `ContentDataSourceSurroundItem` |
  | `ContentProviderSearchResult` | `ContentDataSourceSearchResult` |
  | `ContentProviderSearchRequest` | `ContentDataSourceSearchRequest` |
  | `ContentProviderSiteDataRequest` / `Response` | `ContentDataSourceSiteDataRequest` / `Response` |
  | any other exported `…Provider…` name | replace `ContentProvider` with `ContentDataSource`; list it in `log.md` |

**Test:** type test: a source object without `createContext` is a type error;
`defineContentDataSource({...})` infers `Context` from `createContext`.

**Done when:** `pnpm typecheck` passes; `rg -n "Provider" packages/content/src/public/data-source.ts` shows no exported name with `Provider`.

### 5.2 Registration: `source` / `sources` / `content:sources` (~60 min)

Files: `src/types/config.ts` (content config keys), `src/module/validation.ts`,
`src/module/context-finalization.ts` (`content:providers` hook),
`src/module/augmentations.ts`, `src/module/virtual.ts`
(`#content/virtual/providers`), `src/runtime/server/providers/index.ts`.

1. Rename the content-config keys `provider` → `source` and `providers` →
   `sources`. Using the old keys throws at setup:
   `content.config.ts: "provider" was renamed to "source" and "providers" to "sources" in 1.0.`
2. Rename the Nuxt hook `content:providers` → `content:sources`
   (same mutable `Record<string, string>` argument). Rename the virtual module
   to `#content/virtual/sources`.
3. `getContentProvider(event)` (keep the internal name): for a non-filesystem
   source, load the module's default export, validate it is a
   `ContentDataSource` (name, capabilities, `createContext`, `query`), and wrap
   it with the internal binder from 5.3. Cache the bound result per process.
   A module that exports an old `ContentProvider` (has `query(event, query)`
   and no `createContext`) fails with:
   `Content source "<name>" must default-export defineContentDataSource({...}). ContentProvider modules are not supported in 1.0.`
4. **B-04:** make `nuxt.hook('content:sources', sources => { sources.x = '...' })`
   type-check in a consumer **without a cast**. Check that the
   `declare module '@nuxt/schema'` augmentation reaches the published
   `dist/module.d.mts` (it is in `src/module/augmentations.ts`; confirm the
   built declaration file imports or contains it). Add the hook call to the
   typecheck consumer fixture (`test/fixtures/typecheck`) so `pnpm typecheck`
   proves it.

**Tests:** contracts tests: old keys throw the message; a valid source module
registered through the hook serves a query; an old provider module fails with
the message.

**Done when:** tests pass; `pnpm typecheck` passes with the hook call in the fixture.

### 5.3 The binder becomes internal and validates like the kit (C-30, K304, C238) (~60 min)

1. `git mv src/public/provider-binder.ts src/runtime/server/data-source-binding.ts`;
   rename `bindContentProvider` → `bindContentDataSource(source)`. It takes the
   source only; it calls `source.createContext(event)` itself.
2. Delete the binder's own ETag aggregation; it uses the merge from step 3.4.
3. One result validator, used by both the runtime binding and the conformance
   kit: create `src/core/data-source/validate-result.ts` with the checks the kit
   has today (envelope paging echo: `skip`/`limit` must equal the request;
   JSON purity: no `NaN`, `Infinity`, `undefined`, functions; route-fact
   shape; result-count limits). `src/testing/data-source-contract.ts` imports it
   instead of its own copy.
4. Invalid results fail the request with `provider_result_invalid` (status
   502) and a message naming the source, the operation and the first bad field.

**Tests:** provider tests: a source returning `skip: 99` for a `skip: 0`
request fails with `provider_result_invalid`; a document with a `NaN` field
fails. Both pass today only in the kit, fail at runtime before.

**Done when:** tests pass; demos K304 and C238 pass in custom-source.

### 5.4 Remove the public provider surface (decision 1) (~45 min)

Delete from `packages/content/package.json` `exports` and from `src/public/`:

- `./provider` (`src/public/provider.ts`), with `withContentCache`,
  `isContentProviderResult`, `toContentProviderQuery`,
  `toContentProviderNavigationQuery`, `normalizeProviderDocument`,
  `createContentProviderError` (public copy; the internal one stays in core).
- `./testing/provider-contract` and `./testing/provider-fixture`.

Move the in-memory fixture source into the data-source kit:
`createFixtureContentDataSource` and `createDefaultProviderFixture` become
`createMemoryContentDataSource(fixture?)` and `createDefaultContentFixture()`,
exported from `./testing/data-source-contract`. Move the provider-contract
tests that still protect behavior onto the data-source kit (run them through
`bindContentDataSource`); delete the rest and list each deleted test name in
`log.md` with the reason "covered by <test>".

Update `test/package-*` export-map tests and the API docs generator config.

**Done when:** `node -e "console.log(Object.keys(require('./packages/content/package.json').exports))"` has no `provider` entry; `pnpm test`, `pnpm typecheck`, `pnpm api-docs:check` (regenerate with `pnpm api-docs:generate` first) pass.

### 5.5 One owner per concept (A-07, E-A016) (~60 min)

1. **Provider result:** `src/core/provider-result.ts` and
   `src/runtime/server/provider-result.ts` → keep one in `core/`, the runtime
   file imports it. Delete the duplicate.
2. **Errors:** `src/public/provider-errors.ts` and `src/core/provider-errors.ts`
   → one internal module `src/core/provider-errors.ts`. The public factory is
   only `createContentDataSourceError` (`src/core/data-source-error.ts`).
3. **Cache hints:** internal `ContentCacheHint` (`core/cache-hints.ts`) stays
   the merge model; the public `ContentDataSourceCacheHint` converts into it in
   one function in `core/cache-hints.ts` (`fromDataSourceCacheHint`). Delete
   other converters (`rg "maxAge" packages/content/src --files-with-matches` to find them).
4. **Query cycle (E-A016):** `provider-query → providers/index → filesystem →
   collection-helpers → provider-query`. Split `src/runtime/server/provider-query.ts`
   into `src/core/query/compile.ts` (pure: public query input → canonical plan;
   no imports from `runtime/`) and `provider-query.ts` (dispatch to the
   provider). `collection-helpers.ts` imports only the compiler.

**Regression test:** extend `test/unit/architecture-boundaries.test.ts`
(transitive walker from 4.2) with a cycle check over `src/runtime/server/**` and `src/core/**`:
no import cycles. Fails before (E-A016 cycle).

**Done when:** test passes; `pnpm test` passes.

### 5.6 Route-less records (E-A008) (~45 min)

Data documents have no public route. Today the filesystem adapter gives every
route-less record `contentPath: '/'` (`src/runtime/server/providers/filesystem.ts:66`),
and pathless data documents are missing from collection queries
(`src/core/content/graph.ts:116`).

Decided rule:

- A document of a `data` collection has **no route fact**: no `route` in the
  public envelope (`route` is absent, not `null`), and no `contentPath`.
- The filesystem adapter never invents `contentPath: '/'`.
- Public response validation accepts a missing route only for `data`
  collections; a `page` document without a route stays `provider_result_invalid`.
- `buildContentGraph` indexes every document of a collection in
  `byCollection`, with or without a path.

**Regression test:** contracts: a data collection with two records and no
paths returns both from `many('authors')` and neither has `route`. Fails
before (missing or `provider_result_invalid`).

**Done when:** test passes; demos still pass blog and custom-source data-collection checks.

### 5.7 Cache hints reach the HTTP response (C-28, C288) (~60 min)

Read `docs/content/docs/4.guides/11.provider-search-and-caching.md`: it
promises that a source's cache hint (e.g. `maxAge: 60`) becomes response
freshness. Reproduce with the custom-source demo locally (`node .output/server/index.mjs`):
the `/api/_content/query` response and the SSR page response carry no
freshness header. Find where the merged hint is applied
(`src/runtime/server/cache-hints.ts`, `cache-adapter.ts`, `cache-adapters.ts`,
`plugins/cache.ts`) and why it does not reach the response (likely: the hint
is recorded on the event but the default adapter never writes headers, or SSR
renders through an internal fetch whose headers are dropped).

Decided header contract (default adapter, all hosts):
`cache-control: public, max-age=0, s-maxage=<maxAge>, stale-while-revalidate=<swr>`
and, when present, `etag` and `last-modified`. On Vercel the platform reads
`s-maxage` from the function response. For SSR pages, the page response gets
the merged hint of every content request made during that render.

**Regression tests:** runtime test: a source with `maxAge: 60` → API response
header `s-maxage=60`; e2e or runtime test: SSR page response carries it too.
Both fail before.

**Done when:** tests pass; demos C288 passes on custom-source in production
(second request shows `x-vercel-cache: HIT` or `STALE`).

### 5.8 Portability fixes (B-03, D-05, D-04, C-27) (~60 min)

1. **B-03/D-05:** `hashCanonicalJson` and `canonicalJsonBytes` (`src/cms-contract/hash.ts`)
   take `value: unknown` and validate JSON purity at runtime, throwing
   `TypeError: Not canonical JSON at <path>: <reason>`. Consumers stop casting
   (`as unknown as JsonValue`). Test: an interface-typed object hashes without
   a cast (type test) and a `NaN` throws with its path.
2. **C-27/K303:** the filesystem exporter in
   `src/portability-node/filesystem-export.ts` must not load `nuxt.config.ts`.
   It reads collections from `content.config.ts` (loaded with `jiti`, as today
   for that file) and locales/routing from the resolved contract
   `.ginko/content-contract.json` via `readResolvedContentContract({ root })`
   (requires `nuxt prepare`; if the file is missing, throw
   `Run "nuxt prepare" first: .ginko/content-contract.json is missing.`).
   Add option `configFile` (default `content.config.ts`).
3. **D-04:** `writePortableDirectory` (`src/portability-node/write-directory.ts`)
   creates missing parent directories (`mkdir(..., { recursive: true })`).
   The portable → filesystem return path and a public contract writer are
   **not** part of 1.0: set D-04's status in `findings.md` to
   "partly fixed; return path and writer after 1.0 (L)".

**Tests:** one per item, each fails before.

**Done when:** tests pass; demos K303/X303 pass (docs-site export runs
unchanged after `nuxt prepare`).

## Step verification

```bash
pnpm verify
pnpm release:pack && pnpm test:package-consumer && pnpm test:package-consumer:npm
```

Demos: custom-source must be migrated to `source`/`sources` and
`defineContentDataSource` (this is the documented migration; record the diff
size in `log.md`). Must pass: K303/X303, K304, C238, C288, C013, and all
previously passing custom-source checks. Deploy custom-source.

The `ginko-integration-pocs` `cms-roundtrip` POC must pass on the new tarball
(update its imports the same way).

**Docs:** rewrite `4.guides/10.providers.md` and `13.data-source-adapters.md`
into one guide "Connect a content source" (`4.guides/10.content-sources.md`;
delete the other file and add a redirect in the docs app). Update
`5.reference/10.provider-contract.md` → `10.data-source-contract.md`,
`5.reference/11.package-exports.md`, `4.guides/11.provider-search-and-caching.md`
(header contract). CHANGELOG Breaking with a before/after code block.
