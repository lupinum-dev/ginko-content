# CMS Contract

Use this guide when changing CMS-neutral contracts, portable codecs/directories, MDC conversion, or provider-facing CMS data shapes.

## Ownership

- `src/cms-contract/` owns CMS-neutral schema, build, path, MDC, and exported CMS contract types.
- `src/portability/` owns the pure portable model, codecs, manifests, references, assets, and semantic equality.
- `src/portability-node/` owns safe bounded Node directory I/O.
- `src/public/provider.ts` owns runtime provider interfaces.
- `src/features/` owns framework-free content behavior shared by filesystem and provider-backed content.

## Invariants

- CMS contract code must stay framework-free.
- Pure portability code must not pull Node, Nuxt, Nitro, H3, Convex, or vendor SDK dependencies into its graph.
- Filesystem access stays in `portability-node`; CMS workflow and authorization stay in Ginko CMS.
- CMS/native records should map into the provider contract instead of teaching core about CMS storage models.
- Public CMS contract exports are package subpath commitments.

## Public API Impact

Changes affect:

- `@lupinum/ginko-content/cms-contract`
- `@lupinum/ginko-content/portability`
- `@lupinum/ginko-content/portability/node`
- `@lupinum/ginko-content/agent` — extension points for component-to-markdown serializers and public index rendering. Route parsing, route collection, and site-generation orchestration remain internal.
- provider authors that map CMS data into `ContentProvider` — the single home for provider types is `@lupinum/ginko-content/provider`.

Update the package export map, package contracts, generated API docs, and CMS docs when a CMS subpath changes.

## Migration from the removed CMS importer

Ginko Content 0.3 removes `@lupinum/ginko-content/cms-import`. It parsed source
files into filesystem-runtime records and duplicated mapping decisions now owned
by the versioned portable contract.

- Use `@lupinum/ginko-content/portability` for portable documents, validation,
  structural references/assets, and semantic comparison.
- Use `@lupinum/ginko-content/portability/node` to read, verify, or write a
  bounded portable directory.
- Let Ginko CMS plan and apply draft imports through its operation layer; do not
  rebuild CMS rows from filesystem parser output.

There is no compatibility shim. Convert callers at the boundary and delete the
old mapping path.

## Provider Impact

CMS provider support should enter through the provider contract. Do not add CMS-specific branches to core query execution, navigation, sitemap, or rendering logic.

## Focused Tests

Run:

```bash
pnpm vitest run test/contracts/package-exports-contracts.test.ts test/contracts/architecture-boundaries.test.ts
pnpm vitest run test/contracts/provider-contracts.test.ts test/runtime/api-provider-boundary.test.ts
pnpm typecheck:source
```

Run package/type fixture gate when CMS package exports or provider types change:

```bash
pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck
```

## Do Not Touch

- Do not move Studio workflow, Convex component, MCP, or Ginko CMS bridge logic into this repo.
- Do not import Nuxt, Nitro, Vue, H3, runtime, module, integration, public, or CLI code from `cms-contract`.
- Do not add another filesystem-to-CMS mapper beside the portable contract.
