# Quickstart

Use this when adding Ginko Content to a Nuxt app or creating the first collection/page.

## Install

Use the app's package manager. For pnpm:

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

export const docs = defineCollection('docs', {
  type: 'page',
  source: 'docs/**/*.md',
  schema: z.object({
    title: z.string(),
    description: z.string().optional()
  })
})

export default defineContentConfig({
  collections: {
    docs
  }
})
```

## Minimal route page

```vue
<script setup lang="ts">
import { useContentPage } from '@lupinum/ginko-content/client'
import { docs } from '~/content.config'

const { page } = await useContentPage(docs)
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
pnpm exec ginko-content doctor
pnpm typecheck
pnpm build
```
