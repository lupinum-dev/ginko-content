# Provider Contract Maintainer Notes

The public [Provider Contract](../../../docs/content/docs/5.reference/10.provider-contract.md)
is the canonical behavioral and author-facing documentation. Do not duplicate
the wire shape, provider examples, or response-envelope reference here.

For a framework-free backend adapter, use the
[public data-source adapter guide](../../../docs/content/docs/4.guides/13.data-source-adapters.md).

## Ownership

- `src/public/provider.ts` owns the external provider interface.
- `src/public/provider-query.ts` owns the versioned, JSON-pure query wire and
  lowering helpers. The current hard-cutover version is v3; there is no legacy
  dispatch.
- `src/runtime/server/providers/index.ts` validates providers and preflights
  query capabilities before dispatch.
- `src/runtime/server/provider-query.ts` validates raw query responses and
  builds the canonical public route and resolution envelope.
- `src/runtime/server/provider-route-facts.ts` validates and projects raw route
  facts for navigation, surroundings, search, routes, and sitemap consumers.
- `src/testing/provider-contract.ts` owns the executable author conformance
  suite.

## Change checklist

When the provider contract changes:

1. Prefer a hard cutover for unreleased or prerelease-only wire versions. Do
   not add version negotiation or adapters without a released compatibility
   requirement.
2. Keep query operator constants, public query types, provider capabilities,
   conformance probes, and the public provider reference synchronized.
3. Require complete raw identity and route facts at the provider seam. Apply
   public `only`/`without` selection only after provider-document validation.
4. Keep provider queries JSON-pure and capability-check every exercised
   comparison operator before dispatch.
5. Preserve canonical response envelopes. Explicit offset requests read
   `skip` from `query.plan.paging.skip`; otherwise read `query.plan.skip`.
   Providers must echo the effective offset `skip` and `limit` exactly.
6. Keep preview/publication policy at the provider server boundary and apply it
   consistently to list, first, count, and provider-owned derived operations.
7. Update the changelog and migration reference for every prerelease or semver
   contract break.

Every advertised comparison operator needs a selective conformance probe that
matches at least one expected document and excludes at least one control
document. For example, an `$eq` probe must assert the exact nonempty result set;
an always-false implementation must not pass.

## Verification

Run the focused provider contracts first:

```bash
pnpm vitest run --config vitest.config.ts \
  --project contracts-node \
  test/contracts/provider-contracts.test.ts \
  test/contracts/provider-fixture-conformance.test.ts \
  test/contracts/filesystem-provider-conformance.test.ts
pnpm typecheck
pnpm lint
```

For package or export changes, also run `pnpm release:pack` and the packed
consumer test. Run `pnpm verify` once on the integrated worktree before handoff;
leave `pnpm run release:verify` to CI on the exact final SHA.
