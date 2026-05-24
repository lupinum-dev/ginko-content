# Migration

Use this when converting a Nuxt Content v2/v3 app to Ginko Content.

## Package replacement

```bash
pnpm remove @nuxt/content
pnpm add @lupinum/ginko-content zod
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
| `<ContentDoc>` | `useContentOne(handle, options)` plus `<ContentRenderer>` |
| route path lookup | `useContentOne(handle, { by: { route }, locale })` |
| previous/next page queries | `neighbors(handle, options)` |
| collection navigation | `useContentTree(handle, options)` |
| `useContentSearchData()` | `useContentSearchData(collection)` |
| raw query `item.path` in list UI | `item.path` from `useContentMany()` |
| `<ContentRenderer :value="page.body" />` | `<ContentRenderer :value="page" />` |
| Zod `.editor(...)` | plain Zod schema plus external editor metadata |

## Stale scan

Run this before finishing:

```bash
rg "@nuxt/content|queryCollectionItemSurroundings|useContentSearchData|useContentTree|content\\.database|content\\.preview|content\\.build|\\.editor\\(" app pages components content content.config.ts nuxt.config.ts package.json
```

Expected result is no app-relevant matches. Test fixtures or docs may intentionally mention stale APIs.

## Validation

```bash
npx ginko-content doctor
pnpm lint
pnpm typecheck
pnpm build
```
