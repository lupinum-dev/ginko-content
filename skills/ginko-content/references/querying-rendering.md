# Querying and Rendering

Use this when writing content pages, list pages, navigation links, or renderers.

## Route pages

Use `useContentOne()` for route-backed content. It owns route lookup, locale route state, and fallback metadata.

```vue
<script setup lang="ts">
import { useContentOne, neighbors } from '@lupinum/ginko-content/client'
import { docs } from '~/content.config'

const route = useRoute()
const { locale } = useI18n()
const { data: page } = await useContentOne(docs, {
  by: { route: route.path },
  locale
})
const surround = await neighbors(docs, {
  by: { route: route.path },
  locale: locale.value,
  fields: ['description']
})
</script>

<template>
  <main v-if="page">
    <ContentRenderer :value="page" />
    <UContentSurround
      v-if="surround.length"
      :surround="surround"
    />
  </main>
</template>
```

## List pages

Use `useContentMany()` for route-linked lists:

```vue
<script setup lang="ts">
import { posts as postsCollection } from '~/content.config'

const { locale } = useI18n()
const { data: posts } = await useContentMany(postsCollection, {
  locale,
  sort: { date: 'desc' }
})
</script>

<template>
  <NuxtLink
    v-for="post in posts"
    :key="post.path"
    :to="post.path"
  >
    {{ post.title }}
  </NuxtLink>
</template>
```

The item type comes from the collection schema. Do not create page-local list item interfaces unless the app is intentionally adapting an external payload.

## `path` vs `unprefixedPath`

`path` is the route-ready path on shaped payloads such as `useContentMany()`, `useContentOne()`, navigation, search, or surround data. Use it for UI links and exact raw filters.

`unprefixedPath` is the locale-specific route path before a locale prefix is applied. Use it only when you need to compare the route without the Nuxt i18n prefix.

Do not add locale prefixes to `path` or `unprefixedPath`.

## Rendering

Pass the full document:

```vue
<ContentRenderer :value="page" />
```

Do not pass only the body:

```vue
<ContentRenderer :value="page.body" />
```

## Exact path query

Prefer `useContentOne()` for route pages. Use raw `path` filters only for custom lookup logic:

```ts
const page = await one(docs, {
  by: { path: '/docs/getting-started' },
  locale: 'en'
})
```
