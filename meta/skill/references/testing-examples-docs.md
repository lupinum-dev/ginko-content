# Testing, Examples, And Docs

Use this before finishing changes, and when updating docs, playgrounds, examples, or public behavior.

## Verification Commands

Run the smallest relevant command first:

```bash
pnpm test -- --run test/contracts/query-contracts.test.ts
pnpm test -- --run test/contracts/module-contracts.test.ts
pnpm typecheck
```

Broader commands:

```bash
pnpm test
pnpm lint
pnpm build:packages
pnpm verify
```

`pnpm verify` runs the full pipeline and can be expensive:

1. `pnpm dev:prepare`
2. `pnpm lint`
3. `pnpm build:packages`
4. `pnpm test`
5. `pnpm typecheck`

Use it when public API, module wiring, generated types, provider contracts, or docs examples across multiple apps changed.

## Contract Tests Are The Drift Alarm

High-value contract tests:

- query behavior: `test/contracts/query-contracts.test.ts`
- query lowering: `test/contracts/query-plan-contracts.test.ts`
- client query usage: `test/contracts/app-query-contracts.test.ts`
- page loading: `test/contracts/use-content-page-contracts.test.ts`
- content routes: `test/contracts/content-route-contracts.test.ts`
- navigation: `test/contracts/navigation-contracts.test.ts`
- provider behavior: `test/contracts/provider-contracts.test.ts`
- filesystem conformance: `test/contracts/filesystem-provider-conformance.test.ts`
- server references: `test/contracts/server-reference-contracts.test.ts`
- rendering components: `test/contracts/render-components-contracts.test.ts`
- runtime assets/imports: `test/contracts/runtime-assets-contracts.test.ts`
- module behavior: `test/contracts/module-contracts.test.ts`
- sitemap assertions: `test/contracts/sitemap-assert-contracts.test.ts`
- storage behavior: `test/contracts/storage-contracts.test.ts`

Prefer adding or updating a contract test when the change touches public behavior.

## Docs Locations

- Main docs content: `docs/content/docs/`
- Search docs: `docs/content/docs/search/`
- Sitemap docs: `docs/content/docs/sitemap/`
- Package README: `packages/content/README.md`
- Root orientation: `README.md`, `VISION.md`, `ABSTRACTIONS.md`, `ARCHITECTURE.md`
- Integration reference: `internal/nuxt-integration-sitemap-i18n.md`

Docs should match current code and contract tests. Do not copy upstream Nuxt Content docs blindly.

## Examples And Playgrounds

Useful runnable apps:

- `playground/ginko-basic`
- `playground/ginko-i18n`
- `playground/ginko-search`
- `playground/ginko-search-i18n`
- `examples/*/*`
- `test/fixtures/typecheck`

Run examples directly:

```bash
pnpm --dir examples/<group>/<name> dev
pnpm example <group>/<name>
```

## Documentation Rules

- Use `@lupinum/ginko-content`, not old package names.
- Use `content.config.ts` for collections and schemas.
- Use `useContentOne(handle, { by: { route } })` for route-backed page examples.
- Use `many(handle, options)` / `useContentMany(handle, options)` for list/query examples.
- Use `one(event, handle, options)` / `many(event, handle, options)` for server examples.
- Explain i18n and sitemap ownership accurately.
- Avoid documenting internal runtime paths as app APIs.
- Avoid unsupported MDC-era options.

## Finishing Checklist

Before finalizing a change:

- Confirm the change follows the architecture boundaries.
- Update docs/examples when the public shape changed.
- Run focused tests.
- Run lint/typecheck/build when touched files make that relevant.
- Inspect `git diff` for accidental broad changes or compatibility glue.
