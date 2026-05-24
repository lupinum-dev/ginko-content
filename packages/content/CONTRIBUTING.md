## Content Package Contributing

This package is organized around domain boundaries, not deployment boundaries.

### Layer ownership

- `src/core/`
  Pure content domain logic. No Nuxt, H3, Vue, Nitro, or storage globals.
- `src/parsers/`
  Format-specific parser entrypoints.
- `src/storage/`
  Content source, cache, and manifest orchestration.
- `src/features/`
  User-facing content capabilities such as collections, navigation, localization, search, and sitemap shaping.
- `src/integrations/`
  Nuxt, Nitro, and Vue glue, including runtime config, preview state, scoped storage access, and ingest hooks.
- `src/public/`
  Public package entrypoints.
- `src/runtime/`
  Thin runtime-facing adapters only. Do not put new business logic here.

### Rules

- Prefer moving logic down to `core`, `storage`, or `features` instead of adding new `runtime/*` helpers.
- Keep `core` free of framework imports.
- Keep `storage` free of `runtime/*` imports.
- Keep `features` dependency-injected where practical. Runtime adapters should provide event-bound dependencies.
- If a file name needs words like `utils`, `helpers`, or `shared`, the abstraction is probably still too vague.
- Public API changes belong in `src/public/*` and `package.json` exports together.
- If you need request-local state, put it in `src/integrations/nitro/context.ts`, not in module-level singletons.

### Verification

Before merging:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- package build and at least one representative Nuxt app build when runtime/export wiring changes
