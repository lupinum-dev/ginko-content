# Providers and Cache

Use this when integrating a CMS, custom provider, cache hints, or webhook revalidation.

## Contents

- Provider shape
- Provider registration
- Provider-facing operators
- Cache hints
- Signed revalidation
- Validation

## Provider shape

Provider capabilities must match implemented methods. `query()` and `capabilities.query` are always required. Do not advertise `navigation`, `surroundings`, `searchSections`, `sitemap`, or route-backed collections unless the provider implements and supports the matching methods.

```ts
import type { ParsedContent } from '@lupinum/ginko-content'
import type { ContentProvider } from '#content/server'

export const cmsProvider = {
  name: 'cms',
  capabilities: {
    routeBackedCollections: true,
    dataCollections: true,
    localizedRoutes: false,
    translatedSlugs: false,
    navigation: false,
    surroundings: false,
    searchSections: false,
    sitemap: false,
    query: {
      operators: ['$eq', '$in', '$not', '$and', '$or'],
      limit: true,
      skip: true,
      count: true
    }
  },
  async query<T = ParsedContent>(event, query) {
    return {
      result: [],
      skip: query.skip ?? 0,
      limit: query.limit ?? 0,
      total: 0
    }
  },
  async page<T = ParsedContent>(event, collection, routeOrPath, options) {
    return null
  },
  async routeMeta(event, collection, routeOrPath, options) {
    return null
  }
} satisfies ContentProvider
```

Use `#content/server` inside Nuxt server files. Provider packages and external tests can import the same public server types from `@lupinum/ginko-content/server`.

If `routeBackedCollections` and `localizedRoutes` are both `false`, omit `page()` and `routeMeta()`. The `query()` method and full capability shape are always required.

For a provider with navigation, search sections, or sitemap output, set the matching capability to `true` only after adding the matching method:

```ts
export const cmsProvider = {
  name: 'cms',
  capabilities: {
    routeBackedCollections: true,
    dataCollections: true,
    localizedRoutes: false,
    translatedSlugs: false,
    navigation: true,
    surroundings: true,
    searchSections: true,
    sitemap: true,
    query: {
      operators: ['$eq', '$in', '$not', '$and', '$or'],
      limit: true,
      skip: true,
      count: true
    }
  },
  async query<T = ParsedContent>(event, query) {
    return { result: [], skip: query.skip ?? 0, limit: query.limit ?? 0, total: 0 }
  },
  async page<T = ParsedContent>(event, collection, routeOrPath, options) { return null },
  async routeMeta(event, collection, routeOrPath, options) { return null },
  async navigationQuery(event, query) { return [] },
  async navigation(event, collection, options) { return [] },
  async surroundings(event, collection, path, options) { return [null, null] },
  async searchSections(event, collection, options) { return [] },
  async sitemapEntries(event, options) { return [] }
} satisfies ContentProvider
```

## Provider registration

Register external providers in `content.config.ts`, not as a separate frontend source of truth:

```ts
import { defineCollection, defineContentConfig } from '@lupinum/ginko-content/config'

export const docs = defineCollection('docs', {
  type: 'page',
  source: 'docs/**/*.md'
})

export default defineContentConfig({
  provider: process.env.CONTENT_PROVIDER === 'cms' ? 'cms' : 'filesystem',
  providers: {
    cms: '~/server/content-provider'
  },
  collections: {
    docs
  }
})
```

## Provider-facing operators

Capabilities describe the normalized provider-facing query operators, not every public operator spelling.

Common normalization:

| Public filter | Provider-facing shape |
|---|---|
| `{ field: value }` | `$eq` |
| `{ field: { $nin: values } }` | `$not` plus `$in` |
| `{ path: '/docs/a' }` | `_path` lookup |
| `$and`, `$or` | Preserved |

If docs or types expose a public operator, provider tests must prove the provider supports or rejects the normalized form intentionally.

## Cache hints

Return cache hints from the provider result when the CMS can describe dependencies:

```ts
import { withContentCache } from '#content/server'

async page(request) {
  const page = await cms.findPage(request)

  if (!page) {
    return null
  }

  return withContentCache(page, {
    tags: [`page:${page._path}`],
    maxAge: 60
  })
}
```

## Signed revalidation

Sign the exact body string that is sent:

```ts
const payload = {
  tags: ['page:/docs/getting-started']
}

const body = JSON.stringify(payload)
const signature = await sign(body, process.env.CONTENT_REVALIDATE_SECRET!)

await fetch('/api/_content/revalidate', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-content-signature': signature
  },
  body
})
```

## Validation

Use exported provider fixtures when this repository is available:

```ts
import {
  createFixtureContentProvider,
  createProviderFixture,
  createProviderFixtureEvent
} from '@lupinum/ginko-content/testing/provider-fixture'

import {
  createAuthorDependencyContractProvider,
  runSaasProviderFixtureContractSuite
} from '@lupinum/ginko-content/testing/provider-contract'
```

For app integrations, run the app's typecheck/build and exercise one page, one list query, and one revalidation event.
