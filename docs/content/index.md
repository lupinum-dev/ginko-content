---
title: "@lupinum/ginko-content"
navigation: false
description: "@lupinum/ginko-content is a filesystem-first, provider-neutral content engine for Nuxt. Define collections, resolve routes through them, and render with one coherent API surface."
seo:
  ogImage: '/social-card.png'
---

::u-page-hero
---
orientation: 'horizontal'
ui:
  container: 'lg:items-center'
  title: 'font-display leading-[0.9] sm:leading-[0.88] tracking-[0.01em]'
---
#headline
  :::u-button
  ---
  size: sm
  to: /docs/i18n
  variant: outline
  trailing-icon: i-lucide-arrow-right
  ---
  Real i18n for content routes
  :::

#title
Build [content-rich]{.text-primary} Nuxt apps.

#description
@lupinum/ginko-content gives Nuxt a polished filesystem Markdown workflow with one coherent content contract: define collections, resolve pages by route, localize them cleanly, and render them with Vue.

#links
  :::u-button
  ---
  size: lg
  to: /docs/getting-started/installation
  trailing-icon: i-lucide-arrow-right
  ---
  Get started
  :::

  :u-input-copy{value="npx nuxi module add @lupinum/ginko-content" class="w-[320px] sm:w-[380px]"}

#default
::tabs{class="xl:-mt-10"}
  :::tabs-item{label="content.config.ts" icon="i-simple-icons-typescript"}
  ```ts
  import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

  export const docs = defineCollection('docs', { type: 'page', source: 'docs/**/*.md' })
  export const blog = defineCollection('blog', { type: 'page', source: 'blog/**/*.md' })

  export default defineContentConfig({
    collections: { docs, blog }
  })
  ```
  :::
  :::tabs-item{label="pages/docs/[...slug].vue" icon="i-simple-icons-vuedotjs"}
  ```vue
  <script setup lang="ts">
  const { page } = await useContentPage('docs')
  </script>

  <template>
    <ContentRenderer v-if="page" :value="page" />
  </template>
  ```
  :::
  :::tabs-item{label="nuxt.config.ts" icon="i-lucide-globe"}
  ```ts
  export default defineNuxtConfig({
    modules: ['@lupinum/ginko-content', '@nuxtjs/sitemap'],
    imports: {
      autoImport: true
    },
    content: {
      i18n: {
        defaultLocale: 'en',
        locales: ['en', 'de'],
        translatedSlugs: true
      },
      sitemap: true
    }
  })
  ```
  :::
::
::

::u-container
  :::u-page-grid{class="pb-12 xl:pb-24"}
    :::landing-feature
    ---
    title: Filesystem-first
    description: One public query model. No split brain between raw path lookups and typed collections.
    icon: i-lucide-database
    to: /docs/collections
    ---
    :::
    :::landing-feature
    ---
    title: Route-aware content
    description: Resolve route-backed content with typed query helpers, then add variants, surround links, and search data from the same content graph.
    icon: i-lucide-route
    to: /docs/querying
    ---
    :::
    :::landing-feature
    ---
    title: Real i18n
    description: Locale detection, fallback chains, optional translated slugs, and localized route resolution are first-class.
    icon: i-lucide-languages
    to: /docs/i18n
    ---
    :::
    :::landing-feature
    ---
    title: Typed data
    description: Add Zod schemas to collections and keep authoring, querying, and rendering on one typed model.
    icon: i-lucide-badge-check
    to: /docs/collections/define-collection
    ---
    :::
    :::landing-feature
    ---
    title: Markdown with Vue
    description: Use Markdown and MDC with Vue components, props, and slots without breaking the collection-first shape.
    icon: i-simple-icons-markdown
    to: /docs/essentials/mdc
    ---
    :::
    :::landing-feature
    ---
    title: Navigation and surround
    description: Build docs layouts, sidebars, and prev-next links from collection data instead of app-owned glue.
    icon: i-lucide-panel-left
    to: /docs/rendering
    ---
    :::
    :::landing-feature
    ---
    title: Nuxt SEO ready
    description: Sitemap source registration is package-owned, drafts stay out in production by default, and translated slugs remain opt-in.
    icon: i-lucide-map
    to: /docs/api-reference/module-options
    ---
    :::
    :::landing-feature
    ---
    title: Search
    description: Add MiniSearch or Pagefind search on top of the same collection model instead of indexing a second content system.
    icon: i-lucide-search
    to: /docs/search
    ---
    :::
    :::landing-feature
    ---
    title: Deploy anywhere
    description: Static, server, serverless, or edge. The content contract stays the same across deployment targets.
    icon: i-lucide-globe
    to: /docs/getting-started/project-structure
    ---
    :::
  :::
::

::u-page-section
#title
Everything you need for content that stays coherent

#description
Keep docs sites, localized references, and content-heavy apps on one model instead of mixing file queries, route glue, and SEO glue in the app layer.
::

::u-page-section
---
orientation: horizontal
ui:
  container: 'lg:grid-cols-2 lg:items-center'
---
#title
Markdown meets [Vue]{.text-primary} components

#description
Write Markdown for authors, drop into MDC when you need components, and render it through the same Ginko pipeline.

#links
  :::u-button
  ---
  to: /docs/essentials/mdc
  variant: outline
  color: neutral
  trailing-icon: i-lucide-arrow-right
  ---
  Learn more about MDC
  :::

#default
::tabs
  :::tabs-item{label="content/docs/landing.md" icon="i-simple-icons-markdown"}
  ```mdc
  ---
  title: Product overview
  ---

  ::callout{icon="i-lucide-rocket"}
  Ginko keeps rich content in Vue land without falling back to raw HTML islands.
  ::

  # Ship docs and marketing pages

  :feature-grid
    - Route-aware content lookups
    - Typed frontmatter with Zod
    - Components, props, and slots in Markdown
  ```
  :::
  :::tabs-item{label="app/pages/docs/[...slug].vue" icon="i-simple-icons-vuedotjs"}
  ```vue
  <script setup lang="ts">
  const { page } = await useContentPage('docs')
  </script>

  <template>
    <ContentRenderer v-if="page" :value="page" />
  </template>
  ```
  :::
::
::

::u-page-section
---
orientation: horizontal
ui:
  container: 'lg:grid-cols-2 lg:items-center'
---
#title
Real [i18n]{.text-primary} for content routes

#description
Ginko does not treat localization as an afterthought. Locale detection, fallback chains, shared slugs, and translated slugs all flow through the same route-aware content helpers.

#default
::tabs
  :::tabs-item{label="nuxt.config.ts" icon="i-simple-icons-typescript"}
  ```ts
  export default defineNuxtConfig({
    content: {
      i18n: {
        defaultLocale: 'en',
        locales: ['en', 'de', 'fr'],
        fallback: {
          de: ['en'],
          fr: ['en']
        },
        translatedSlugs: true
      }
    }
  })
  ```
  :::
  :::tabs-item{label="content/" icon="i-lucide-folders"}
  ```txt
  content/
    en/
      1.docs/
        1.getting-started.md
    de/
      1.dokumentation/
        1.erste-schritte.md
    fr/
      1.documentation/
        1.premiers-pas.md
  ```
  :::
  :::tabs-item{label="app/pages/docs/[...slug].vue" icon="i-simple-icons-vuedotjs"}
  ```vue
  <script setup lang="ts">
  const { page } = await useContentPage('docs')
  </script>
  ```
  :::
::

#links
  :::u-button
  ---
  to: /docs/i18n
  variant: outline
  color: neutral
  trailing-icon: i-lucide-arrow-right
  ---
  Learn more about i18n
  :::
::

::u-page-section
---
orientation: horizontal
ui:
  container: 'lg:grid-cols-2 lg:items-center'
---
#title
Nuxt SEO, search, and docs navigation stay on one model

#description
Because Ginko owns the content route model, sitemap generation, navigation trees, neighbor links, and search indexing all build on the same collection data.

#links
  :::u-button
  ---
  to: /docs/api-reference/module-options
  variant: outline
  color: neutral
  trailing-icon: i-lucide-arrow-right
  ---
  Learn more about runtime options
  :::

#default
::tabs
  :::tabs-item{label="nuxt.config.ts" icon="i-simple-icons-typescript"}
  ```ts
  export default defineNuxtConfig({
    modules: ['@lupinum/ginko-content', '@nuxtjs/sitemap']
  })
  ```
  :::
  :::tabs-item{label="app/pages/docs/[...slug].vue" icon="i-simple-icons-vuedotjs"}
  ```vue
  <script setup lang="ts">
  const { page, surround } = await useContentPage('docs', {
    surround: true
  })
  </script>

  <template>
    <ContentRenderer v-if="page" :value="page" />
    <UContentSurround :surround="surround" />
  </template>
  ```
  :::
  :::tabs-item{label="search" icon="i-lucide-search"}
  ```ts
  export default defineNuxtConfig({
    modules: ['@lupinum/ginko-content'],
    imports: {
      autoImport: true
    }
  })
  ```
  :::
:: 
::

::page-section-cta
::
