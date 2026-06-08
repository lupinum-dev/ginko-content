# CMS Contract

Use this guide when changing CMS-neutral contracts, CMS import helpers, MDC conversion, or provider-facing CMS data shapes.

## Ownership

- `src/cms-contract/` owns CMS-neutral schema, build, path, MDC, and exported CMS contract types.
- `src/cms-import/` owns import helpers.
- `src/public/provider.ts` owns runtime provider interfaces.
- `src/features/` owns framework-free content behavior shared by filesystem and provider-backed content.

## Invariants

- CMS contract code must stay framework-free.
- CMS import helpers must not pull Nuxt/Nitro runtime dependencies into CMS contract code.
- CMS/native records should map into the provider contract instead of teaching core about CMS storage models.
- Public CMS contract exports are package subpath commitments.

## Public API Impact

Changes affect:

- `@lupinum/ginko-content/cms-contract`
- `@lupinum/ginko-content/cms-import`
- provider authors that map CMS data into `ContentProvider`.

Update `meta/public-surface.json`, package export contracts, and docs when CMS subpath exports change.

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
- Do not make CMS import helpers a second provider contract.
