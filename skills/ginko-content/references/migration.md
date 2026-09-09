# Migration

Use this when converting a Nuxt Content v2/v3 app to Ginko Content.

Use the supported portable boundary when moving an existing filesystem-backed
Ginko application to a CMS. Do not read `.nuxt` or package-manager cache files:

```bash
pnpm exec ginko-content portable assess
pnpm exec ginko-content portable export .ginko/cms-import
```

The assessment is local and read-only. It reports source and contract
incompatibilities before export. The export destination must not exist. Pass
the verified portable directory to the CMS migration command; CMS target,
authentication, apply, publish, receipts, and provider cutover remain CMS
responsibilities.

## Package replacement

```bash
pnpm remove @nuxt/content
pnpm add @lupinum/ginko-content@0.3.0 zod
```

In `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['@lupinum/ginko-content']
})
```

## Replacement map

| Nuxt Content pattern | Ginko pattern |
|---|---|
| `@nuxt/content` in `modules` | `@lupinum/ginko-content` |
| `import { defineCollection } from '@nuxt/content'` | `@lupinum/ginko-content/config` |
| `queryContent()` | `one(handle, options)` or `many(handle, options)` |
| `<ContentDoc>` | `useContentPage(handle, options)` plus `<ContentRenderer>` |
| route path lookup | `useContentPage(handle, { fallback })` (resolves against the current route) |
| previous/next page queries | `useContentPage(handle, { surround: true })` or the `surround(handle, options)` verb |
| collection navigation | `navigation(handle, options)` (pair with `useAsyncData`) |
| search UI data | `useContentSearch(options)` |
| raw query `item.path` in list UI | `item.route.resolvedPath` from `many(handle, options)` |
| `<ContentRenderer :value="page.body" />` | `<ContentRenderer :value="page" />` |
| Zod `.editor(...)` | plain Zod schema plus external editor metadata |

## Stale scan

Run this before finishing:

```bash
rg "@nuxt/content|queryCollectionItemSurroundings|useContentOne|useContentMany|useContentHead|useContentTree|useContentNavigation|useContentNeighbors|useContentSwitchLocalePath|useContentSearchData|useContentSearchResults|useContentVariants|content\\.database|content\\.preview|content\\.build|\\.editor\\(" app pages components content content.config.ts nuxt.config.ts package.json
```

Expected result is no app-relevant matches. Test fixtures or docs may intentionally mention stale APIs.

## Validation

```bash
npx ginko-content doctor
pnpm lint
pnpm typecheck
pnpm build
```
