# Provider Contract

Use this guide when changing provider capabilities, provider return shapes, cache hints, provider errors, or provider-backed operations.

## Ownership

- `src/public/provider.ts` owns the external provider interface.
- `src/core/provider-errors.ts` owns provider error codes and framework-neutral status metadata.
- `src/public/provider-errors.ts` adapts provider errors to H3.
- `src/runtime/server/providers/index.ts` validates provider modules and enforces capabilities before dispatch.
- `src/runtime/server/provider-result.ts` normalizes provider results and cache hints.
- `src/testing/provider-contract.ts` and `src/testing/provider-fixture.ts` are the reusable provider test surface.

## Invariants

- Every provider declares all capabilities explicitly.
- Unsupported operations fail loudly with stable provider error codes.
- Query operators are allowed only when advertised in `capabilities.query.operators`.
- `ContentProvider.query()` returns only canonical `ContentQueryResponse<T>` envelopes:
  `{ result: T[], skip, limit, total }` for list queries, `{ result: T | undefined }`
  for first queries, and `{ result: number }` for count queries.
- Raw arrays, raw documents, raw numbers, and `undefined` are invalid provider query results.
- Provider result wrappers must have the provider result marker and exact data/cache shape.
- Cache hints are normalized through `src/core/cache-hints.ts`.

## Public API Impact

Provider changes affect external provider authors. Treat these as public:

- `ContentProvider`
- `ContentProviderCapabilities`
- `ContentProviderResult`
- `MaybeContentProviderResult`
- cache hint types.
- provider error codes.

If these change, update `meta/public-surface.json`, provider docs, generated `#content/server` declarations if needed, and type fixtures.

## Provider Impact

When adding a capability:

- add it to `ContentProviderCapabilities`.
- validate it in `src/runtime/server/providers/index.ts`.
- make the filesystem provider advertise the correct value.
- add conformance tests for supported and unsupported providers.

## Focused Tests

Run:

```bash
pnpm vitest run test/contracts/provider-contracts.test.ts test/contracts/provider-fixture-conformance.test.ts test/contracts/filesystem-provider-conformance.test.ts
pnpm vitest run test/runtime/api-provider-boundary.test.ts test/contracts/sitemap-query-contracts.test.ts
pnpm typecheck:source
```

Run the package/type fixture gate when provider public types change:

```bash
pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck
```

## Do Not Touch

- Do not add a generic provider adapter layer unless the provider contract cannot express the real requirement.
- Do not silently coerce malformed provider results.
- Do not let provider-specific storage models leak into `core`.
- Do not document capabilities a provider does not advertise and test.
