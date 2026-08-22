<p align="center">
  <img src="https://raw.githubusercontent.com/lupinum-dev/ginko-content/main/docs/public/icon.png" width="128" alt="Ginko Content">
</p>

<h1 align="center">@lupinum/ginko-content</h1>

<p align="center">
  Use one typed content model for Nuxt pages, queries, navigation, search, localization, and build output.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lupinum/ginko-content"><img src="https://img.shields.io/npm/v/@lupinum/ginko-content?color=315d3b" alt="npm version"></a>
  <a href="https://github.com/lupinum-dev/ginko-content/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/ginko-content/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="https://github.com/lupinum-dev/ginko-content/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-315d3b" alt="MIT license"></a>
</p>

> [!WARNING]
> Version `1.0.0-beta.3` is a prerelease. Install it from npm's `next`
> channel. The stable `0.3` line remains on `latest`.

## Why use this package?

Content features become difficult to maintain when routes, lists, search, and
localization use separate data. This package makes the collection definition
the source of truth for those features.

Keep Markdown and data files in `content/`. Use typed collection handles in the
Nuxt application. The same handles also drive server queries and generated
output.

## Requirements

- Node.js 22.18–22.x, 24.11–24.x, or 26+
- Nuxt 4.5.1 through Nuxt 4.x
- Vue 3.5.35 through Vue 3.x
- ESM; CommonJS `require()` is not supported

## Installation

Use the Nuxt CLI:

```bash
npx nuxi module add @lupinum/ginko-content@1.0.0-beta.3
```

Or install and register the module by hand:

```bash
pnpm add @lupinum/ginko-content@1.0.0-beta.3
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@lupinum/ginko-content'],
})
```

## Quick start

Define a collection:

```ts
// content.config.ts
import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const pages = defineCollection({
  type: 'page',
  source: '**/*.md',
})

export default defineContentConfig({
  collections: { pages },
})
```

Create `content/index.md`:

```md
---
title: Welcome
---

# Welcome
```

Render the active route:

```vue
<!-- pages/[...slug].vue -->
<script setup lang="ts">
import { pages } from '~~/content.config'

definePageMeta({ key: route => route.path })

const { page, status } = await useContentPage(pages)

if (status.value === 'not-found') {
  throw createError({ statusCode: 404, statusMessage: 'Page not found', fatal: true })
}
</script>

<template>
  <ContentRenderer v-if="page" :value="page" />
</template>
```

## Main capabilities

- Markdown and Comark component rendering.
- YAML, JSON, and CSV ingestion.
- Typed collections and frontmatter.
- Route-aware pages and server-side queries.
- Exact filtered counts and server-resolved references.
- Locale-aware routes and fallback rules.
- Navigation, search, sitemap, and prerender helpers.
- Agent-readable Markdown and recoverable Markdown 404s.
- A provider contract for remote or database-backed sources.

Optional features stay explicit. Install `pagefind`, `katex`, or
`beautiful-mermaid` only when the application uses the related search, math, or
diagram integration.

## Documentation

- [Documentation](https://ginko-content.lupinum.com)
- [Quick start](https://ginko-content.lupinum.com/docs/get-started/quickstart)
- [Guides](https://ginko-content.lupinum.com/docs/guides)
- [API reference](https://ginko-content.lupinum.com/docs/reference)
- [Repository](https://github.com/lupinum-dev/ginko-content)

## Support and security

Open a [GitHub issue](https://github.com/lupinum-dev/ginko-content/issues) for a
reproducible defect. Join the [Lupinum OSS Discord](https://discord.gg/RPH6SeA36N)
for usage questions.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/lupinum-dev/ginko-content/security/advisories/new).

## License

This package is available under the [MIT License](https://github.com/lupinum-dev/ginko-content/blob/main/LICENSE).
It is developed by [Lupinum OG](https://lupinum.com).
