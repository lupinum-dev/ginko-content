---
title: Ginko Content
navigation: false
description: Filesystem-first content for Nuxt sites that need coherent routes, types, localization, search, and SEO without a runtime content database.
seo:
  ogImage: '/social-card.png'
---

::u-page-hero
---
orientation: horizontal
ui:
  container: 'lg:items-center'
  title: 'font-display leading-[0.9] sm:leading-[0.88] tracking-[0.01em]'
---
#headline
  :::u-button
  ---
  size: sm
  to: /docs/why-ginko
  variant: outline
  trailing-icon: i-lucide-arrow-right
  ---
  See why Ginko exists
  :::

#title
Content sites without the [content infrastructure]{.text-primary}.

#description
Keep Markdown in Git. Define collections once. Use the same typed content model for pages, navigation, localization, search, sitemap, and server reads.

#links
  :::u-button
  ---
  size: lg
  to: /docs/get-started/installation
  trailing-icon: i-lucide-arrow-right
  ---
  Build your first page
  :::

  :u-input-copy{value="npx nuxi module add @lupinum/ginko-content" class="w-[320px] sm:w-[380px]"}

#default
::tabs
  :::tabs-item{label="content.config.ts" icon="i-simple-icons-typescript"}
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
  :::
  :::tabs-item{label="pages/[...slug].vue" icon="i-simple-icons-vuedotjs"}
  ```vue
  <script setup lang="ts">
  import { pages } from '~/content.config'

  const { page } = await useContentPage(pages)
  </script>

  <template>
    <ContentRenderer v-if="page" :value="page" />
  </template>
  ```
  :::
::
::

::u-container
  :::u-page-grid{class="pb-12 xl:pb-24"}
    :::landing-feature
    ---
    title: One content model
    description: Collections own schemas, routes, localization, and every query made against their documents.
    icon: i-lucide-layers
    to: /docs/how-it-works/collections
    ---
    :::
    :::landing-feature
    ---
    title: Files stay canonical
    description: Navigation, search, sitemap, and prerender output are rebuildable derivatives, not competing stores.
    icon: i-lucide-file-check-2
    to: /docs/why-ginko/why-less-is-more
    ---
    :::
    :::landing-feature
    ---
    title: Localization has identity
    description: Resolve fallback, translated slugs, and language switching through the same document identity.
    icon: i-lucide-languages
    to: /docs/how-it-works/localization-model
    ---
    :::
    :::landing-feature
    ---
    title: Portable by default
    description: Ship SSR, static, serverless, or edge output without a runtime content database.
    icon: i-lucide-globe-2
    to: /docs/resources/deployment
    ---
    :::
  :::
::

::u-page-section
---
orientation: horizontal
ui:
  container: 'lg:grid-cols-2 lg:items-center'
---
#title
The limitation is the feature

#description
Ginko does not put a CMS, SQL store, editorial workflow, or generic compatibility layer in the core. You give up database-first scale and get fewer moving parts, one source of truth, and clearer ownership.

#links
  :::u-button
  ---
  to: /docs/why-ginko/how-ginko-compares
  variant: outline
  color: neutral
  trailing-icon: i-lucide-arrow-right
  ---
  Compare Ginko with Nuxt Content
  :::

#default
```txt
content files or provider
          ↓
      collections
          ↓
 normalized documents
    ↙     ↓      ↘
 pages  search  sitemap
```
::
