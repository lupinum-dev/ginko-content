# Quickstart

Use this when adding Ginko Content to a Nuxt app or creating the first collection/page.

## Install

```bash
pnpm add @lupinum/ginko-content zod
```

Add the module:

```ts
export default defineNuxtConfig({
  modules: ['@lupinum/ginko-content']
})
```

## Minimal content config

```ts
import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'
import { z } from 'zod'

export default defineContentConfig({
  collections: {
    docs: defineCollection({
      type: 'page',
      source: 'docs/**/*.md',
      schema: z.object({
        title: z.string(),
        description: z.string().optional()
      })
    })
  }
})
```

## Minimal route page

```vue
<script setup lang="ts">
import { useContentOne } from '@lupinum/ginko-content/client'
import { docs } from '~/content.config'

const route = useRoute()
const { data: page } = await useContentOne(docs, {
  by: { route: route.path }
})
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
  docs/
    index.md
    getting-started.md
```

## First checks

```bash
npx ginko-content doctor
pnpm typecheck
pnpm build
```
