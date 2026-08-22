<p align="center">
  <img src="docs/public/icon.png" width="128" alt="Ginko Content">
</p>

<h1 align="center">Ginko Content</h1>

<p align="center">
  Build typed Nuxt content from files without giving up routes, search, localization, or server queries.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@lupinum/ginko-content"><img src="https://img.shields.io/npm/v/@lupinum/ginko-content?color=315d3b" alt="npm version"></a>
  <a href="https://github.com/lupinum-dev/ginko-content/actions/workflows/ci.yml"><img src="https://github.com/lupinum-dev/ginko-content/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-315d3b" alt="MIT license"></a>
</p>

> [!WARNING]
> Version `1.0.0-rc.1` is a release candidate. Install it from the `next`
> channel. The stable `0.3` line remains on the `latest` channel.

## Why use Ginko Content?

A content site often starts with Markdown files. It becomes harder to maintain
when pages, navigation, search, localization, and sitemaps use separate data.

Ginko Content gives these features one source of truth. Define each collection
once. Use the same typed collection handle in pages, server queries, navigation,
search, and build output.

Your content stays in readable files. Your Nuxt application gets explicit APIs
and predictable route behavior.

## When to use it

Use Ginko Content when your Nuxt application needs:

- Markdown or data files stored with the source code.
- Typed frontmatter and collection rules.
- Route-aware content pages.
- Server-side content queries.
- Localized routes and fallback rules.
- Navigation, search, sitemap, or prerender output from the same content model.

Do not use this package when you need a complete hosted CMS, an editorial admin
interface, or a visual page builder. A remote CMS can implement the provider
contract without changing the application-facing query API.

## Requirements

- Node.js 22.18–22.x, 24.11–24.x, or 26+
- Nuxt 4.5.1 through Nuxt 4.x
- Vue 3.5.35 through Vue 3.x
- ESM; CommonJS `require()` is not supported

## Installation

Add the release candidate with the Nuxt CLI:

```bash
npx nuxi module add @lupinum/ginko-content@1.0.0-rc.1
```

You can also install and register it by hand:

```bash
pnpm add @lupinum/ginko-content@1.0.0-rc.1
```

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@lupinum/ginko-content'],
})
```

## Quick start

Define one collection:

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

This document renders at `/`.
```

Render the current route:

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

## What the package provides

- Markdown and Comark component rendering.
- YAML, JSON, and CSV ingestion.
- Typed collection definitions.
- Route-aware page loading with `useContentPage()`.
- Server reads for single records, lists, pagination, navigation, and surround
  data.
- Exact filtered counts and server-resolved references without extra browser requests.
- Locale-aware routing with explicit fallback behavior.
- MiniSearch, Pagefind, and provider-owned search options.
- Sitemap and prerender integration.
- Agent-readable Markdown, indexes, and recoverable Markdown 404s.
- A provider contract for advanced content sources.

Static Nuxt paths belong in Nuxt I18n. Content paths belong in collection
routes. Sitemap XML belongs in `@nuxtjs/sitemap`. Do not maintain a second route
table for the same content.

## Documentation

- [Documentation site](https://ginko-content.lupinum.com)
- [Quick start](./docs/content/docs/1.get-started/1.quickstart.md)
- [Guides](./docs/content/docs/4.guides)
- [API reference](./docs/content/docs/5.reference)
- [Package README](./packages/content/README.md)

## Contributing and development

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you open a pull request. Run
the normal repository gate before handoff:

```bash
pnpm verify
```

Maintainers use [MAINTAINING.md](./MAINTAINING.md) for dependency and release
work. Protected GitHub Actions publish certified artifacts. Do not publish from
a workstation.

## Support and security

Open a [GitHub issue](https://github.com/lupinum-dev/ginko-content/issues) for a
reproducible defect. Join the [Lupinum OSS Discord](https://discord.gg/RPH6SeA36N)
for usage questions.

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/lupinum-dev/ginko-content/security/advisories/new)
or follow [SECURITY.md](./SECURITY.md).

## License

Ginko Content is available under the [MIT License](./LICENSE). It is developed
by [Lupinum OG](https://lupinum.com).

Ginko Content is derived from Nuxt Content and has substantially diverged.
Nuxt Content, Nuxt UI, and Comark retain their respective licenses and credits.
