[![nuxt-content-social-card](./docs/public/social-card.png)](https://ginko-content.nuxt.dev)

# Ginko

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![License][license-src]][license-href]

Ginko is a filesystem-first, provider-neutral content engine for Nuxt. Author files in `content/`, define collections in `content.config.ts`, then query, route, render, search, and emit sitemap entries through those collections. The filesystem provider is the default today; the core architecture leaves room for future providers.

- [📖 &nbsp;Package README](./packages/content/README.md)
- [📚 &nbsp;Docs app](./docs)
- [👾 &nbsp;Ginko basic playground](./playground/ginko-basic)
- [🌍 &nbsp;Ginko i18n playground](./playground/ginko-i18n)
- [🔎 &nbsp;Ginko search playground](./playground/ginko-search)
- [CMS integration spec](./CMS-SPEC.md)
- [Active refactor target](./a_target.md)

## Release Compatibility

`@lupinum/ginko-content@2.13.4` is the content engine release for the first
clean Ginko stack:

| Package | Version | Role |
| --- | ---: | --- |
| `@lupinum/ginko-content` | `2.13.4` | Filesystem-first Nuxt content engine |
| `@lupinum/ginko-cms` | `0.1.0` | Optional Convex-backed CMS product |
| `@lupinum/ginko-cms-convex` | `0.1.0` | CMS Convex component |
| `@lupinum/ginko-cms-contract` | `0.1.0` | Framework-neutral CMS contract |

Ginko Content remains CMS-neutral. The CMS consumes only the runtime-neutral
contract/import subpaths; it does not make this package a Studio, admin UI, or
MCP host.

## Ginko Direction

- Required `content.config.ts` collection definitions
- Route-aware page loading through `useContentPage(handle)`
- Typed collections with `defineCollection()`
- `.navigation.yml` support for bare folders
- MDC and Vue components in markdown
- Locale-aware routing with explicit fallback chains
- Strong HMR on the filesystem provider
- Provider-neutral server architecture for future content sources

## Current Public API

Use `useContentPage(handle)` in route components. Use the unified collection
API for explicit reads: `one`, `many`, `paginate`, `backlinks`, `resolveOne`,
`variants`, `tree`, and `neighbors`. Vue apps use the matching composables:
`useContentOne`, `useContentMany`, `useContentPagination`,
`useContentBacklinks`, `useContentResolveOne`, `useContentVariants`,
`useContentTree`, `useContentNeighbors`, and `useContentLocaleSwitch`.

Route-backed pages should load through `useContentPage(handle)`. Explicit
single-document reads use `useContentOne(handle, { by })`: `by: { route }` for
public URLs, `by: { path }` for raw content paths, and `by: { ref }` for
authored references. Lists use `many(handle, { where, sort, limit })`.

## Workspace

This repository is now a pnpm workspace centered on one module:

- `@lupinum/ginko-content` in [`packages/content`](./packages/content)

Ginko is published as `@lupinum/ginko-content` and should be registered under that package name.

This repository is the core engine and default filesystem provider. It is not a CMS, Studio, admin UI, or MCP workflow host. Future CMS-backed content should plug in through the provider contract as a separate package or product.

CMS builders should use [`CMS-SPEC.md`](./CMS-SPEC.md) as the source of truth
for provider behavior, cache hints, dependency tags, preview isolation,
revalidation, and testing expectations.

Development apps and fixtures also live in the workspace:

- `docs`
- `playground/ginko-basic`
- `playground/ginko-i18n`
- `playground/ginko-search`
- `examples/*/*`
- `test/fixtures/typecheck`

## 💻 Development

- Clone repository
- Install dependencies using `pnpm install`
- Prepare using `pnpm dev:prepare`
- Try playground using `pnpm dev`
- Start docs using `pnpm docs`
- Build packages using `pnpm build:packages`
- Build docs using `pnpm docs:build`
- Build maintained examples using `pnpm examples:build`
- Test using `pnpm test`
- Typecheck using `pnpm typecheck`
- Run the full verification pipeline using `pnpm verify`
- Before publishing or changing public API behavior, use [docs/release-checklist.md](./docs/release-checklist.md)

Run a specific example directly from the workspace with `pnpm --dir examples/<group>/<name> dev` or use `pnpm example <group>/<name>`.

## License

[MIT](./LICENSE)  

[npm-version-src]: https://img.shields.io/npm/v/@lupinum/ginko-content/latest.svg?style=flat&colorA=18181B&colorB=28CF8D
[npm-version-href]: https://npmjs.com/package/@lupinum/ginko-content

[npm-downloads-src]: https://img.shields.io/npm/dm/@lupinum/ginko-content.svg?style=flat&colorA=18181B&colorB=28CF8D
[npm-downloads-href]: https://npm.chart.dev/@lupinum/ginko-content

[license-src]: https://img.shields.io/github/license/lupinum-dev/ginko-content.svg?style=flat&colorA=18181B&colorB=28CF8D
[license-href]: https://github.com/lupinum-dev/ginko-content/blob/main/LICENSE
