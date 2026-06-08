# Change Guide

Use this checklist before opening a change against `packages/content`.

## Common Recipes

### Add A Query Operator

Change `src/core/query/operators.ts`, query filtering/lowering, public query types, provider capabilities, filesystem provider behavior, docs, and provider contracts together. Run query, provider, API boundary, typecheck, and package/type fixture tests.

### Add A Provider Capability

Change `ContentProviderCapabilities`, provider validation, provider wrappers, filesystem provider advertisement, provider fixture/conformance tests, and provider docs together. Unsupported providers must fail with stable provider errors.

### Add A Parser

Add the parser in `src/parsers/`, expose it through `parsers/index.ts`, update parse options if needed, and test the transform path. Do not change public rendering or storage code unless the parsed document shape changes.

### Change Route-Page Loading

Start in `src/runtime/query/documents.ts` and `src/runtime/app/composables/use-content-page.ts`. Keep `useContentPage(handle)` as the beginner route-page API. Update docs-drift tests and consumer type fixtures.

### Change I18n Fallback Behavior

Start in `src/features/localization/` and runtime query locale modules. Keep public `resolved.*` metadata consistent across `one`, `many`, `variants`, locale switch, navigation, sitemap, and search. Run i18n query, navigation, sitemap, and type fixture tests.

### Change Navigation Tree Behavior

Start in `src/features/navigation/` and `src/runtime/query/navigation.ts`. Do not special-case frontend navigation in Vue composables. Run navigation contracts and app query contracts.

### Change Search Behavior

Start in `src/features/search/`, `src/runtime/server/search.ts`, and `src/runtime/app/composables/search.ts`. Keep MiniSearch defaults centralized in `src/module/options.ts`. Provider-backed search must respect provider capabilities.

### Change Sitemap Behavior

Start in `src/features/sitemap/query.ts`, `src/module/integration-hooks.ts`, `src/module/derived-route-discovery.ts`, and runtime sitemap providers. Derived route discovery must stay rebuildable from content files plus resolved content context.

### Change Public Exports

Update the package export, public facade, `meta/public-surface.json`, package export contracts, generated declaration contracts if needed, docs, and type fixtures. Do not add bridge exports just to make imports convenient.

### Change Generated Imports

Update `src/module/runtime-assets.ts` source lists and generated type code together. Run runtime-assets contracts, module contracts, typecheck, and package/type fixture tests.

## PR Checklist

- I did not add public exports accidentally.
- I updated docs/examples for public behavior.
- I used collection handles in public examples.
- I added or updated contract tests.
- I did not put domain logic in runtime or Vue composables.
- I did not add `any` or `as unknown as` in query, i18n, or provider paths without isolating it.
- I did not create a second source of truth.
- I checked whether the change affects provider capabilities.
- I checked generated imports and declarations when touching module setup.
- I ran the focused tests listed in the relevant subsystem guide.

## Default Verification

For narrow changes, run the focused tests from the subsystem guide plus:

```bash
pnpm typecheck:source
git diff --check
```

For public API, provider, module output, generated declarations, docs examples, or release-sensitive changes, also run:

```bash
pnpm build:packages && pnpm --filter @lupinum/ginko-content-test-typecheck typecheck
```

Before release handoff, a maintainer should run:

```bash
pnpm verify
pnpm run release:verify
```
