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

## Document Normalization Seam

Third-party providers emit only the canonical envelope's required fields and let
core derive everything else. The minimal input set is:

- `collection`, `locale`, `path`, `body` (plus any frontmatter data)
- `id`, `canonicalKey`, and `type` are optional and derived when omitted
- `file` is optional and omitted for providers with no backing file (e.g.
  CMS-backed documents).

`shapeProviderDocument(document, options)` takes that minimal document and
returns the canonical `ContentPageResult`, deriving the localized route `path`,
`variants`, `localePaths` and the `resolved` envelope.
`normalizeProviderDocument(document)` is the same seam without route shaping —
it fills the derivable identity fields (`id`, `canonicalKey`, `type`) and returns
the canonical document. Providers should never hand-build route/locale metadata.

Provider packages should import these helpers from the Nitro-free provider
subpath:

```ts
import {
  normalizeProviderDocument,
  shapeProviderDocument,
  type ProviderDocumentInput,
  type ShapeProviderDocumentOptions
} from '@lupinum/ginko-content/provider'
```

Inside Nuxt server runtime files, `#content/server` also exposes them for
convenience.

`examples/advanced/cms-cache-contract/server/cms-provider.ts` is the reference
provider tutorial and emits only this minimal set.

## Wire Restrictions

The 0.2 provider boundary is the canonical wire contract. Providers must not
emit 0.1 underscore envelope fields. `LEGACY_PROVIDER_ENVELOPE_FIELDS` is the
canonical testing list for those removed fields.

Provider queries receive the public field names from `ContentProviderQuery`.
Filter and sort keys are names such as `path`, `locale`, `draft`, and `partial`;
providers should not expect internal underscore aliases.

Provider input has no cursor. Offset-style pagination uses `skip` only when the
provider advertises `capabilities.query.skip`. `count` is not portable unless
the provider advertises `capabilities.query.count`; providers that declare it
as unsupported must reject count plans with `unsupported_query_shape`.

Projection applies to the returned result rows only. A projected row may not be
a full route envelope, but it still must not contain legacy underscore envelope
fields.

## Reusable Test Assertions

The testing subpath exposes focused assertions for provider authors that want to
verify their own fixtures without adopting the built-in fixture collections:

```ts
import {
  expectNoLegacyProviderEnvelopeFields,
  expectProviderCapabilities,
  expectProviderDocumentEnvelope,
  expectUnsupportedProviderOperation,
  expectUnsupportedProviderQueryShape,
  unwrapProviderContractResult
} from '@lupinum/ginko-content/testing/provider-contract'
```

- `expectProviderCapabilities(provider, expected)` checks declared capability
  flags and query operator support.
- `expectProviderDocumentEnvelope(page)` checks a complete shaped 0.2 document
  envelope and scans for legacy fields.
- `expectNoLegacyProviderEnvelopeFields(value)` deep-scans any provider result,
  including projected query rows where a full-envelope assertion cannot apply.
- `expectUnsupportedProviderOperation()` and
  `expectUnsupportedProviderQueryShape()` assert the stable typed errors for
  unsupported operations and unsupported query capabilities.
- `unwrapProviderContractResult()` unwraps cache-marked provider results before
  assertions.

The fixture-bound `runProviderContractSuite()` remains the conformance suite for
the built-in fixture model. External providers can compose the assertions above
against their own collections, fixtures, and supported sort fields.

## Public API Impact

Provider changes affect external provider authors. Treat these as public:

- `ContentProvider`
- `ContentProviderCapabilities`
- `ContentProviderResult`
- `MaybeContentProviderResult`
- cache hint types.
- provider error codes.
- testing provider contract assertions from
  `@lupinum/ginko-content/testing/provider-contract`.
- the wire surface mirrored on `./provider`: `ContentProviderQuery`,
  `ContentProviderNavigationOptions`, `ContentQueryPlan`,
  `PROVIDER_QUERY_VERSION`, `toContentProviderQuery`,
  `toContentProviderNavigationQuery`, `withContentCache`,
  `normalizeProviderDocument`, `shapeProviderDocument`,
  `ProviderDocumentInput`, and `ShapeProviderDocumentOptions`.

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
pnpm vitest run --config vitest.config.ts --project nuxt test/contracts/provider-fixture-conformance.test.ts test/contracts/filesystem-provider-conformance.test.ts
pnpm vitest run test/contracts/provider-contracts.test.ts
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
