---
name: ginko
description: Use this skill when working on Ginko, the @lupinum/ginko-content Nuxt content engine, including content.config.ts collections, defineCollection schemas, unified one/many/resolveOne/tree/neighbors APIs, useContentOne/useContentMany route loading, ContentRenderer rendering, filesystem content routing, providers, i18n, translated slugs, navigation, search, sitemap integration, package exports, docs, examples, tests, or migration work from Nuxt Content v2/v3. Use it to avoid API drift and preserve Ginko's provider-neutral, collection-first architecture.
---

# Ginko

Use this skill for changes in `/Users/matthias/Git/0_libs/WORK/nuxt-content-v2`.

Ginko is `@lupinum/ginko-content`: a filesystem-first, provider-neutral content engine for Nuxt. It is inspired by Nuxt Content, but it is not a drop-in clone of every Nuxt Content v2/v3 behavior. Preserve its narrower public contract.

## Start Here

1. Identify whether the task is app-facing usage, module/config work, provider/storage internals, docs/examples, or tests.
2. Read the relevant reference file below before editing:
   - Public exports, imports, and API boundaries: [references/public-surface.md](references/public-surface.md)
   - `content.config.ts`, collections, schemas, references, and querying: [references/collections-querying.md](references/collections-querying.md)
   - Route-backed pages, rendering, navigation, and i18n: [references/routing-rendering-i18n.md](references/routing-rendering-i18n.md)
   - Provider contract, filesystem storage, parsing, and layering: [references/providers-storage.md](references/providers-storage.md)
   - Search, sitemap, and Nuxt SEO integration: [references/search-sitemap.md](references/search-sitemap.md)
   - Nuxt module options, runtime wiring, generated types, and auto-imports: [references/module-config.md](references/module-config.md)
   - Tests, examples, docs, and verification commands: [references/testing-examples-docs.md](references/testing-examples-docs.md)
3. Check the live source before changing public behavior. Prefer actual code and contract tests over old docs.

## Non-Negotiable Product Boundaries

- Collections are the public query boundary. Do not add global, collection-less content queries.
- App route pages should use `useContentOne(collectionHandle, { by: { route } })` unless there is a concrete reason to use lower-level primitives.
- Server content access goes through the provider contract. API handlers and server helpers should not branch on provider names.
- `content.config.ts` owns collections, providers, schemas, and references. `nuxt.config.ts` `content` owns runtime behavior.
- Filesystem behavior is first-class for the default provider, but do not make filesystem details mandatory for every future provider.
- Nuxt i18n is the locale source of truth when installed. Ginko adds content-specific fallback, translated-slug behavior, and canonical identity.
- Ginko owns content-backed sitemap entries. `@nuxtjs/sitemap` owns XML output, hreflang rendering, sitemap indexes, and robots integration.
- Keep CMS, Studio, browser editing, MCP workflows, runtime content mutation, permissions, uploads, and database editorial state out of core.

## Repository Map

- `packages/content/src/module.ts`: Nuxt module entrypoint.
- `packages/content/src/config.ts`: public config exports.
- `packages/content/src/public/`: public facade exports.
- `packages/content/src/core/`: pure domain logic.
- `packages/content/src/features/`: framework-free features built on core.
- `packages/content/src/integrations/`: Nitro/Vue bindings.
- `packages/content/src/storage/`: filesystem provider storage, manifests, validation.
- `packages/content/src/runtime/`: Nuxt and Nitro runtime entrypoints.
- `packages/content/src/types/`: shared public and internal types.
- `docs/content/docs/`: user-facing docs.
- `test/contracts/`: behavior contracts; use these as the drift alarm.
- `playground/ginko-*` and `examples/*/*`: runnable usage examples.

## Development Rules

- Prefer hard cutovers when correcting bad foundations; do not add compatibility shims unless explicitly requested.
- Put pure behavior in `core` or `features`, Nuxt/Nitro/Vue coupling in `integrations` or `runtime`, filesystem-specific logic in `storage`/filesystem provider paths, and public API facades in `public`.
- Update docs and examples when public behavior changes.
- Add or update contract tests for public API, provider behavior, i18n, search, sitemap, routing, and generated types.
- Before finishing, run the smallest relevant tests, plus broader verification when the change affects shared behavior.
