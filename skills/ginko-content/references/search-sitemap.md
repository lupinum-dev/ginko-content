# Search and Sitemap

Use this when wiring search UI, generated search data, or public sitemap output.

## Search data

Use `useContentSearch()` for search UI, its query, and its result payloads:

```vue
<script setup lang="ts">
import { useContentSearch } from '@lupinum/ginko-content/client'
import { docs } from '~/content.config'

const {
  query,
  results,
  files,
  searchNavigation,
  setQuery
} = await useContentSearch({ collection: docs })
</script>
```

`searchNavigation` (from `useContentSearch`) is the sole search-navigation surface — it is projected for search UI. Do not pass it to layout/sidebar navigation.

## Layout navigation

Use the `navigation()` verb with `useAsyncData` for layout navigation:

```ts
import { useAsyncData } from '#imports'
import { navigation } from '@lupinum/ginko-content/client'
import { docs } from '~/content.config'

const { data: tree } = await useAsyncData(
  'layout-navigation:en',
  () => navigation(docs, { locale: 'en' })
)
```

## Sitemap setup

Use Nuxt Sitemap for XML output:

```bash
pnpm add @nuxtjs/sitemap
```

```ts
export default defineNuxtConfig({
  modules: [
    '@lupinum/ginko-content',
    '@nuxtjs/sitemap'
  ],
  site: {
    url: process.env.NUXT_PUBLIC_SITE_URL || 'https://docs.ginko-content.dev'
  },
  content: {
    sitemap: {
      assert: {
        enabled: true,
        mode: 'both',
        minUrlsPerSitemap: 1,
        requiredCollections: ['docs']
      }
    }
  }
})
```

Replace `site.url` with the production domain.

## Sitemap checks

```bash
pnpm build
npx ginko-content doctor --i18n
```

For i18n apps, validate the mode Nuxt Sitemap actually emitted. Some apps emit a
single `sitemap.xml` urlset; others emit `sitemap_index.xml` plus child
sitemaps:

```bash
test -f .output/public/sitemap.xml || test -f .output/public/sitemap_index.xml
find .output/public/__sitemap__ -maxdepth 1 -name '*.xml' -print 2>/dev/null || true
```

Submit the sitemap URL that Nuxt Sitemap generated for the configured mode. Do
not add route rules, `nitro.prerender.ignore`, or disable Nuxt Sitemap i18n mode
only to force a physical sitemap shape.

## Search index checks

When a static search payload exists, verify every locale has records:

```bash
node -e "const data=require('./.output/public/api/_content/search/index.json'); const rows=Array.isArray(data)?data:data.records||[]; console.log(rows.reduce((a,r)=>({...a,[r.locale]:(a[r.locale]||0)+1}),{}))"
```
