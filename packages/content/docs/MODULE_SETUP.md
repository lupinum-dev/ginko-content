# Module Setup

Use this guide when changing Nuxt module setup, generated imports, runtime config, Nitro config, static output, or module defaults.

## Ownership

- `src/module.ts` is the setup coordinator.
- `src/module/defaults.ts` owns module defaults.
- `src/module/options.ts` owns option normalization for i18n, sitemap, search, and Nuxt module integration.
- `src/module/context-finalization.ts` owns provider hooks, final context resolution, runtime collection projection, and runtime config application.
- `src/module/runtime-config.ts` owns public/private runtime config shaping.
- `src/module/runtime-assets.ts` owns runtime auto-imports, components, generated declarations, and generated type templates.
- `src/module/nitro-config.ts` owns Nitro config mutation.
- `src/module/static-output.ts` owns production static artifacts.

## Invariants

- `module.ts` should remain a coordinator, not a second implementation of helper modules.
- Defaults have one source of truth.
- Generated imports and generated declarations must stay in sync.
- Runtime config must keep secrets private and public config serializable.
- Nitro hooks may be registered before `modules:done`; hook execution should prefer finalized context when available.

## Public API Impact

Module setup changes can affect:

- package exports.
- generated `#content/server` declarations.
- Nuxt auto-imports.
- runtime config shape.
- docs examples and quickstarts.

Update public-surface metadata and runtime-assets contracts when generated imports or declarations change.

## Provider Impact

Provider changes usually enter module setup through `content:providers`, provider config validation, or runtime config. Keep provider validation in `validation.ts` or runtime provider modules, not in app-facing composables.

## Focused Tests

Run:

```bash
pnpm vitest run test/contracts/module-contracts.test.ts test/contracts/runtime-config-contracts.test.ts test/contracts/runtime-assets-contracts.test.ts
pnpm vitest run test/contracts/integration-hooks-contracts.test.ts test/contracts/sitemap-assert-contracts.test.ts
pnpm typecheck:source
```

Run the package/type fixture gate when generated types, runtime config, or package output changes:

```bash
pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck
```

## Do Not Touch

- Do not add second defaults in runtime helpers.
- Do not add generated declarations by hand without updating `runtime-assets.ts` source lists.
- Do not put backend invariants in frontend orchestration.
- Do not keep old and new module paths side by side for unreleased internals.
