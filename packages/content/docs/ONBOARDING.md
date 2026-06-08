# Onboarding — `@lupinum/ginko-content`

A single page for new contributors. Read this before opening a pull request
against `packages/content`. It complements [`ARCHITECTURE.md`](../ARCHITECTURE.md)
(which describes the layering and its rules) by answering the question
"I have a change to make — where does it go?"

For deeper subsystem maps, use:

- [`QUERY_PIPELINE.md`](./QUERY_PIPELINE.md) for query operators, operation results, and provider query dispatch.
- [`PROVIDER_CONTRACT.md`](./PROVIDER_CONTRACT.md) for provider capabilities, provider errors, and cache hints.
- [`MODULE_SETUP.md`](./MODULE_SETUP.md) for Nuxt module setup, generated imports, runtime config, and static output.
- [`RENDERING.md`](./RENDERING.md) for renderer components, route-page composables, and content head behavior.
- [`CMS_CONTRACT.md`](./CMS_CONTRACT.md) for CMS-neutral contracts and import helpers.
- [`CHANGE_GUIDE.md`](./CHANGE_GUIDE.md) for common recipes and the PR checklist.

---

## The layer map

The package is split into six directories under `src/`. Each has a single
responsibility, and the allowed import direction is strict:

| Directory | Owns | Typical contributor change |
|---|---|---|
| `core/` | Pure domain logic: query AST, content graph, reference resolution, `Result<T, E>`, `ContentError` codes. No framework imports. | New query operator, new error code, graph-traversal fix. |
| `features/` | User-facing capabilities built on `core`: navigation tree building, collection resolution, locale-aware result shaping, search sections, translated slugs. Still framework-free. | New collection-level helper (`queryCollectionFoo`), navigation tweak, search-section shape change. |
| `storage/` | Default filesystem/Nitro storage bridge: source reading, parsed-artifact cache, validation orchestration, reference-enrichment over query responses. Depends on `core`, `features`, `integrations`; not on `runtime`, `module`, `public`, or `cli`. | Cache strategy change, new validation rule, new source-level enrichment. |
| `integrations/` | Platform bindings. `nitro/` owns request-scoped runtime context, ingest orchestration, runtime config, preview state. `vue/` owns component discovery and the renderer. | New ingest wiring, new request-scoped cache field. |
| `parsers/` | Entry points for markdown, yaml, json, csv ingestion. | New parser, new markdown transformer. |
| `public/` + `runtime/` | The package's public export surface (`server.ts` / `client.ts` / `config.ts`) and its thin runtime adapters that bind `features/` to Nitro/Nuxt. | Rare. If you find yourself adding real logic here, it belongs in `features/` instead. |

**The dependency rule, restated:** `core/` → nothing; `features/` → `core/`;
`storage/` → `core + features + integrations`; `runtime/` → everything. Never
the reverse. `core/` and `features/` must never import Nitro, Vue, or Nuxt.
`storage/` is the runtime storage bridge, but pure files such as
`storage/validation.ts` must stay framework-free.

---

## Walkthrough: "I want to add a new parser"

Say you want to support `.toml` front matter.

1. **`parsers/toml.ts`** — implement the parse function. Follow the shape of
   `parsers/yaml.ts`: take `(id, rawBody, options)` and return a
   `ParsedContent`-shaped object.
2. **`types/runtime.ts`** — extend `ParseContentOptions` with any new
   option bag (e.g. `toml?: TomlParseOptions`).
3. **`integrations/nitro/ingest.ts`** — register the parser in the `defu`
   options merge and ensure `transformContent` dispatches to it (the existing
   extension-based router does this automatically once your parser is exposed
   from `parsers/index.ts`).
4. **Test** — add a fixture to `test/fixtures/` and a contract test in
   `test/contracts/parser-contracts.test.ts`.

What you should *not* touch: `storage/content.ts`, `core/`, or `public/*`.
The pipeline is already generic over parser choice.

---

## Walkthrough: "I want to add a query operator"

Say you want public `where` filters to support a new safe operator.

1. **`core/query/operators.ts`** — add the operator to the supported operator
   list and validation helper.
2. **`core/query/filter.ts`** — compile public `where` input into the internal
   query shape. Keep public operators explicit; do not smuggle user regexes in
   through a convenience alias.
3. **`runtime/server/providers/filesystem.ts`** — advertise the operator only
   when the filesystem provider really supports it.
4. **`types/query.ts`** — expose the operator in the public query types.
5. **Docs** — update `docs/content/docs/4.querying/` and
   `docs/content/docs/9.api-reference/`.
6. **Test** — add or update provider contract tests in `test/contracts/`.

What you should *not* do: add a frontend-only filter that the provider cannot
enforce. Provider capabilities are runtime truth.

---

## Walkthrough: "I want to add an error code"

Say a new validation rule surfaces a `DUPLICATE_ORDER_KEY` failure.

1. **`core/errors.ts`** — extend the `ContentErrorCode` union with the new
   literal, document when it is emitted in the JSDoc, add it to
   `storage/validation.ts#KNOWN_CODES`.
2. **Emit it** — at the check site, return
   `fail(createContentError('DUPLICATE_ORDER_KEY', file, reason, details))`.
   Never `throw` inside `storage/validation.ts`; return a `Result`.
3. **HTTP mapping** — `runtime/server/query-executor.ts` maps error codes to
   h3 `createError({ statusCode, ... })`. Add your code to the switch with the
   correct status (typically 400 for content-author mistakes, 500 for infra).
4. **Test** — assert `expect(result).toMatchObject({ ok: false, error: { code: 'DUPLICATE_ORDER_KEY' } })`,
   not `expect(() => ...).toThrow()`.

---

## Where does request-scoped state go?

**Hard rule:** `integrations/nitro/context.ts` — nowhere else.

Mutable `let` at module scope in Nitro is a silent bug: the process is reused
across requests, so state leaks. Anything that varies per request — parsed
content caches, in-flight promise dedup maps, the memoized graph, even the
clock — lives on `ContentRuntimeContext` and is attached to
`event.context.__contentRuntime`.

If you need a new request-scoped field:

1. Extend the `ContentRuntimeContext` interface in
   `integrations/nitro/context.ts`.
2. Initialize it in `createRuntimeContext()` (or lazily on first access, like
   `caches`).
3. Access it through `getContentRuntimeContext(event)` — never cache the
   return value across requests.
4. For expensive per-request computations, wrap them in `memoizeRuntimeValue`.

---

## Local workflow

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm --dir packages/content build
pnpm verify
```

The contract suite under `test/contracts/` is the source of truth for
behavioral guarantees. If you change the public shape, update the contract
first, watch it fail, then make it pass.

---

## One-line reviewer checklist

- Layering direction respected (run the grep in `ARCHITECTURE.md#Dependency Rules`).
- No new module-level mutable state.
- Expected failures return `Result`, not throw.
- Every new public export has JSDoc.
- Contract test added or updated.
