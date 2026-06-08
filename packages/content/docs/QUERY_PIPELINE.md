# Query Pipeline

Use this guide when changing public query options, query operators, result envelopes, or route/page resolution.

## Ownership

The query path is deliberately split:

- `src/types/query.ts` is the stable type barrel.
- `src/types/query-parts/` owns public, transport, collection, and result type groups.
- `src/core/query/operators.ts` owns supported operator names.
- `src/core/query/filter.ts`, `lower.ts`, `plan.ts`, and `execute.ts` own pure query compilation/execution.
- `src/runtime/query/` owns public operation assembly: `one`, `many`, `paginate`, `tree`, `neighbors`, `variants`, `backlinks`, and response envelopes.
- `src/runtime/server/provider-query.ts` and `src/runtime/server/query-executor.ts` own provider dispatch and provider capability enforcement.

## Invariants

- Public query operators must be explicit and provider-advertised.
- Provider capability checks are runtime truth; do not add frontend-only behavior the provider cannot enforce.
- Public result shapes must use `ContentQueryResponse` envelopes consistently.
- Localized result metadata must use the public `resolved.*` model, not private `_locale` internals.
- Invalid public input should fail at the API/runtime boundary with actionable errors.

## Public API Impact

Changing query options or result shapes can affect:

- `@lupinum/ginko-content/client`
- `@lupinum/ginko-content/server`
- generated `#content/server` types
- app composables in `src/runtime/app/composables/use-content*.ts`
- docs under `docs/content/docs/4.querying/` and `9.api-reference/`

Update `meta/public-surface.json` only when an export changes, not for internal query helpers.

## Provider Impact

For a new operator or query shape, update these together:

- operator constants and public query types.
- filesystem provider capability advertisement.
- provider contract tests.
- docs for supported provider capabilities.

## Focused Tests

Run:

```bash
pnpm vitest run test/contracts/query-contracts.test.ts test/contracts/app-query-contracts.test.ts test/contracts/query-response-contracts.test.ts test/runtime/api-provider-boundary.test.ts
pnpm vitest run test/contracts/provider-contracts.test.ts test/contracts/filesystem-provider-conformance.test.ts
pnpm typecheck:source
```

Run the package/type fixture gate when public types change:

```bash
pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck
```

## Do Not Touch

- Do not put query-domain logic in Vue composables.
- Do not add compatibility shims for old fluent query APIs.
- Do not bypass provider capabilities to make a public query pass.
- Do not add `any` or `as unknown as` in query paths without isolating it at a boundary and adding a contract test.
