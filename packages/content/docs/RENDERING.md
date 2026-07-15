# Rendering

Use this guide when changing `ContentRenderer`, markdown rendering, Prose components, content head behavior, or route-page composables.

## Ownership

- `src/runtime/app/components/ContentRenderer*.vue` owns document rendering.
- `src/runtime/app/components/internal/` owns renderer internals.
- `src/runtime/app/composables/use-content-page.ts` owns the sole route-page composable. There is no dedicated head composable — apps call `useSeoMeta()`/`useHead()` themselves from the resolved document (VNEXT.md 10.4, hard-cut deletion of `useContentHead`).
- `src/runtime/app/composables/search.ts` owns the sole search composable (`useContentSearch`).
- `src/integrations/vue/` owns component discovery, HTML tag handling, and markdown refs.
- `src/parsers/markdown.ts` and markdown plugins own parsed markdown shape.

## Invariants

- `ContentRenderer` receives the full content document, not `document.body`.
- Vue composables are wrappers around the runtime query API; they should not own provider/domain logic.
- Public route-page loading should use collection handles in docs and examples.
- Rendering must respect the same localized route metadata as server queries.
- Markdown plugin runtime config must remain serializable.

## Public API Impact

Rendering changes can affect:

- `ContentRenderer`
- `ContentRendererInline`
- `useContentPage`
- generated component web types.

Update docs and docs-drift tests when public examples change.

## Provider Impact

Provider-backed documents must still produce the document shape expected by renderers: a `route` (`resolvedPath`, `alternates`), parsed `body`, title/excerpt/head metadata, and a `resolution` (`requested.locale`, `resolved.locale`, `usedFallback`) when applicable.

## Focused Tests

Run:

```bash
pnpm vitest run test/contracts/render-components-contracts.test.ts test/contracts/use-content-page-contracts.test.ts test/contracts/app-query-contracts.test.ts
node scripts/docs-drift.mjs && pnpm vitest run test/contracts/runtime-config-contracts.test.ts
pnpm typecheck:source
```

Run build when components or web types change:

```bash
pnpm build:packages
```

## Do Not Touch

- Do not make composables repair malformed provider data.
- Do not introduce another route-page loading model in beginner docs.
- Do not pass body-only values to renderer examples.
- Do not add renderer behavior that depends on filesystem-only metadata.
