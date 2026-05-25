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
| `<ContentDoc>` | `useContentPage(handle, options)` plus `<ContentRenderer>` |
| route path lookup | `useContentPage(handle, options)` |
| previous/next page queries | `useContentPage(handle, { surround })` or `useContentNeighbors(handle, options)` |
| collection navigation | `useContentTree(handle, options)` |
| `useContentSearchData()` | `useContentSearchData('collectionName')` |
| raw query `item.path` in list UI | `item.path` from `useContentMany()` |
| `<ContentRenderer :value="page.body" />` | `<ContentRenderer :value="page" />` |
| Zod `.editor(...)` | plain Zod schema plus external editor metadata |

## Stale scan

Run this before finishing:

```bash
rg "@nuxt/content|queryCollection\\(|queryCollectionItemSurroundings|queryCollectionNavigation|queryCollectionSearchSections|content\\.database|content\\.preview|content\\.build|\\.editor\\(|:value=\"[^\"]*\\.body\"" . \
  --glob 'app.vue' \
  --glob 'app/**' \
  --glob 'pages/**' \
  --glob 'components/**' \
  --glob 'layouts/**' \
  --glob 'content/**' \
  --glob 'content.config.ts' \
  --glob 'nuxt.config.ts' \
  --glob 'package.json' \
  --glob '!**/.nuxt/**' \
  --glob '!**/.output/**' \
  --glob '!**/node_modules/**'
```

Expected result is no app-relevant matches. Test fixtures or docs may intentionally mention stale APIs.

## Validation

```bash
pnpm exec ginko-content doctor
pnpm lint
pnpm typecheck
pnpm build
```
