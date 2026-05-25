# Search and Sitemap

Use this when wiring search UI, generated search data, or public sitemap output.

## Contents

- Search data
- Layout navigation
- Sitemap setup
- Sitemap checks
- Search index checks

## Search data

Use `useContentSearchData()` for UI search payloads:

```vue
<script setup lang="ts">
import { useContentSearchData } from '@lupinum/ginko-content/client'

const {
  files,
  searchNavigation,
  searchTerm
} = await useContentSearchData('docs')
</script>
```

`searchNavigation` is projected for search UI. Do not pass it to layout/sidebar navigation.

For localized apps, pass the locale ref or getter so persistent layouts update when the locale changes:

```ts
const { locale } = useI18n()
const search = await useContentSearchData('docs', { locale })
```

Configure search to target route-backed collections:

```ts
export default defineNuxtConfig({
  content: {
    search: {
      collections: ['docs']
    }
  }
})
```

Omitting `collections` means all collections. Avoid that when the app has data-only collections unless the provider intentionally supports data search output.

## Layout navigation

Use `useContentTree()` for layout navigation:

```ts
import { useContentTree } from '@lupinum/ginko-content/client'
import { docs } from '~/content.config'

const { navigation } = await useContentTree(docs, {
  locale: 'en'
})
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
    url: 'https://example.com'
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
pnpm exec ginko-content doctor --i18n
```

For i18n apps, Nuxt Sitemap defaults to a sitemap index:

```bash
test -f .output/public/sitemap_index.xml
find .output/public/__sitemap__ -name '*.xml' -maxdepth 1 -print
```

Submit `/sitemap_index.xml`. If `.output/public/sitemap.xml/` exists as a generated redirect directory, ignore that static artifact and validate the sitemap index plus child sitemaps. Do not add route rules or disable Nuxt Sitemap i18n mode only to force a physical `sitemap.xml` file.

## Search index checks

When a static search payload exists, verify every locale has records:

```bash
node -e "const data=require('./.output/public/api/_content/search/index.json'); const rows=Array.isArray(data)?data:data.records||[]; console.log(rows.reduce((a,r)=>({...a,[r.locale||r._locale]:(a[r.locale||r._locale]||0)+1}),{}))"
```
