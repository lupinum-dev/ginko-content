# @lupinum/ginko-content

Filesystem-first, provider-neutral content for Nuxt 4.

`@lupinum/ginko-content` gives you:

- file-authored pages and navigation from `content/`
- required typed collections via `content.config.ts`
- Markdown, MDC, YAML, JSON, and CSV ingestion
- locale-aware content routing
- built-in search endpoints and first-class search composables
- a server-side provider contract for advanced custom sources

## Install

```bash
pnpm add @lupinum/ginko-content zod
```

Add the module to your `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
  modules: ['@lupinum/ginko-content']
})
```

Ginko is published as `@lupinum/ginko-content` and should be registered under that package name.

The default provider reads files from your Nuxt project. The package does not include a CMS UI, Studio, admin panel, or content editing workflow.

## Compatibility

`@lupinum/ginko-content@2.13.4` targets Nuxt `>=4.0.0` and is verified against
Nuxt `4.4.6`. It is compatible with the first Ginko CMS release line:
`@lupinum/ginko-cms@0.1.0`, `@lupinum/ginko-cms-convex@0.1.0`, and
`@lupinum/ginko-cms-contract@0.1.0`.

The CMS boundary uses `./cms-contract` and `./cms-import`. Those subpaths are
runtime-neutral seams for package integration, not a bundled CMS runtime.

## Basic usage

Create content files:

```text
content/
  index.md
  guide/getting-started.md
```

Render content in a catch-all page:

```vue
<script setup lang="ts">
import { pages } from '~/content.config'

const { page } = await useContentPage(pages)
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
```

Define the collection in `content.config.ts`:

```ts
import { defineCollection, defineContentConfig, fields } from '@lupinum/ginko-content/config'
import { z } from 'zod'

export const pages = defineCollection('pages', {
  type: 'page',
  source: ['index.md', 'guide/**/*.md'],
  schema: z.object({
    title: fields.text()
  })
})

export default defineContentConfig({
  collections: {
    pages
  }
})
```

## Docs

- Documentation: [ginko-content.nuxt.dev](https://ginko-content.nuxt.dev)
- Repository: [github.com/lupinum-dev/ginko-content](https://github.com/lupinum-dev/ginko-content)
