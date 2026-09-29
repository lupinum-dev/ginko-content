# Querying and Rendering

Use this when writing content pages, list pages, navigation links, or renderers.

## Route pages

Use `useContentPage()` for route-backed content. It resolves the handle against the current route, keeps SSR/hydration stable across route changes, and suppresses stale-page flashes. It does **not** throw a default 404, does **not** mutate `<head>`, and does **not** perform redirects — the app owns that policy, using the resolution facts on the returned document.

```vue
<script setup lang="ts">
import { createError, useContentPage } from '#imports'
import { docs } from '~~/content.config'

const { page, previous, next } = await useContentPage(docs, {
  surround: true
})

if (import.meta.server && !page.value) {
  throw createError({ statusCode: 404, statusMessage: 'Document not found' })
}
</script>

<template>
  <main v-if="page">
    <ContentRenderer :value="page" />
    <UContentSurround :previous="previous" :next="next" />
  </main>
  <p v-else>Document not found.</p>
</template>
```

`surround: true` performs one documented extra request for `previous`/`next`. Omit it when a page doesn't need neighbor links.

## List pages

Use `many()` with `useAsyncData` for route-linked lists:

```vue
<script setup lang="ts">
import { useAsyncData } from '#imports'
import { many } from '@lupinum/ginko-content/client'
import { posts as postsCollection } from '~~/content.config'

const { locale } = useI18n()
const { data: posts } = await useAsyncData(
  () => `posts:${locale.value}`,
  () => many(postsCollection, { locale: locale.value, sort: { date: 'desc' } }),
  { watch: [locale] }
)
</script>

<template>
  <NuxtLink
    v-for="post in posts"
    :key="post.route.resolvedPath"
    :to="post.route.resolvedPath"
  >
    {{ post.title }}
  </NuxtLink>
</template>
```

The item type comes from the collection schema. Do not create page-local list item interfaces unless the app is intentionally adapting an external payload.

## The document envelope

Every resolved document carries a `route` and a `resolution`, not a bare `path`:

- `route.requestedPath` — the selector the app queried with, if any.
- `route.resolvedPath` — the document's canonical public path. Use this for links.
- `route.alternates` — proven locale destinations (`source: 'variant'` for a concrete translation; `source: 'fallback'` with a `resolvedLocale` only for the fallback route used by the current resolution). Build locale-switcher links from this, not from manual prefixing.
- `resolution.requested.locale` / `resolution.resolved.locale` / `resolution.usedFallback` — the locale that was asked for vs. the locale actually served.

Do not manually prepend or strip locale prefixes on a path — read `route.alternates` instead.

## Rendering

Pass the full document:

```vue
<ContentRenderer :value="page" />
```

Do not pass only the body:

```vue
<ContentRenderer :value="page.body" />
```

## Bodies parsed elsewhere

When a CMS or database stores Markdown, parse it on the server with
`parseMdcBody()` from `@lupinum/ginko-content/cms-contract` and send only the
resulting `body` to the page. `parseMdcBody()` runs in Node and in V8 isolates
such as Convex functions. Render the body with the lean body renderer:

```vue
<script setup lang="ts">
import ContentBodyRenderer, { type MarkdownRoot } from '@lupinum/ginko-content/body-renderer'

defineProps<{ body: MarkdownRoot }>()
</script>

<template>
  <ContentBodyRenderer :body="body" :policy="{ components: {} }" :components="{}" />
</template>
```

The body renderer is about 7 KB gzip. Never import
`@lupinum/ginko-content/cms-contract` in client code; it contains the parser
and Zod (about 180 KB gzip).

## Exact path query

Prefer `useContentPage()` for route pages. Use raw `by: { path }` filters only for custom lookup logic:

```ts
const page = await one(docs, {
  by: { path: '/docs/getting-started' },
  locale: 'en'
})
```
