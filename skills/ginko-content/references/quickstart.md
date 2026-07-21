# Quickstart

Use this when adding Ginko Content to a Nuxt app or creating the first collection/page.

## Install

```bash
pnpm add @lupinum/ginko-content@next
```

Add the module:

```ts
export default defineNuxtConfig({
  modules: ['@lupinum/ginko-content'],
  imports: {
    autoImport: true
  }
})
```

## Minimal content config

```ts
import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const pages = defineCollection({
  type: 'page',
  source: '**/*.md'
})

export default defineContentConfig({
  collections: { pages }
})
```

## Minimal route page

```vue
<script setup lang="ts">
import { pages } from '~~/content.config'

const { page } = await useContentPage(pages)
</script>

<template>
  <main v-if="page">
    <ContentRenderer :value="page" />
  </main>
</template>
```

## Minimal content tree

```txt
content/
  index.md
  getting-started.md
```

## First checks

```bash
npx ginko-content doctor
pnpm typecheck
pnpm build
```
