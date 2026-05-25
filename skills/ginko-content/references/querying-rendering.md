# Querying and Rendering

Use this when writing content pages, list pages, navigation links, or renderers.

## Contents

- Route pages
- List pages
- `_path` vs `path`
- Navigation
- Rendering
- Exact path query

## Route pages

Use `useContentPage()` for route-backed content. It owns route lookup, locale route state, not-found behavior, stale route hiding, and optional neighbor data.

```vue
<script setup lang="ts">
import { useContentPage } from '@lupinum/ginko-content/client'
import { docs } from '~/content.config'

const { page, surround } = await useContentPage(docs, {
  surround: {
    fields: ['description']
  }
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
import { useContentMany } from '@lupinum/ginko-content/client'
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

## `_path` vs `path`

`_path` is the canonical content path from the source document. Use it for exact raw filters and low-level query logic.

`path` is the route-ready path on shaped payloads such as `useContentMany()`, `useContentPage()`, navigation, search, or surround data. Use it for UI links.

Do not add locale prefixes to `_path` or `path`.

## Navigation

Use `useContentTree()` for layout/sidebar navigation:

```vue
<script setup lang="ts">
import { useContentTree } from '@lupinum/ginko-content/client'
import { docs } from '~/content.config'

const { locale } = useI18n()
const { navigation } = await useContentTree(docs, { locale })
</script>

<template>
  <NuxtLink
    v-for="item in navigation"
    :key="item.path"
    :to="item.path"
  >
    {{ item.title }}
  </NuxtLink>
</template>
```

Navigation ordering follows filesystem/path ordering. Use numeric filename or folder prefixes when order matters. Do not add `order` frontmatter expecting it to sort navigation.

Hide a page from navigation with:

```md
---
title: Internal notes
navigation: false
---
```

Use `.navigation.yml` for section metadata. Top-level custom metadata requires `content.navigation.fields`.

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

Prefer `useContentPage()` for route pages. Use raw `_path` filters only for custom lookup logic:

```ts
import { one } from '@lupinum/ginko-content/client'
import { docs } from '~/content.config'

const page = await one(docs, {
  by: { path: '/docs/getting-started' },
  locale: 'en'
})
```
