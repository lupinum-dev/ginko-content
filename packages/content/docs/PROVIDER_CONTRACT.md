# Provider Contract

Use this guide when changing provider capabilities, raw result shapes, cache
hints, or provider-backed operations.

## Ownership

- `src/public/provider.ts` is the external provider interface.
- `src/runtime/server/providers/index.ts` validates providers and preflights
  query capabilities before dispatch.
- `src/runtime/server/provider-query.ts` turns raw provider documents into the
  canonical public `route` and `resolution` envelope.
- `src/runtime/server/provider-route-facts.ts` validates and projects raw route
  facts for navigation, surround, search, routes, and sitemap consumers.
- `src/testing/provider-contract.ts` is the executable author conformance suite.

## Provider shape

Every provider implements `query`. Optional operation support is inferred from
method presence; do not add boolean capability flags for operations.

```ts
import type { ContentProvider } from '@lupinum/ginko-content/provider'

export default {
  name: 'custom',
  capabilities: {
    query: {
      operators: ['$eq', '$in', '$contains'],
      pagination: ['offset', 'cursor']
    }
  },
  async query(event, query) {},
  async navigation(event, query, options) {},
  async surroundings(event, collection, contentPath, options) {},
  async search(event, request) {},
  async siteData(event, request) {},
  async routes(event) {},
  async invalidate(event, input) {}
} satisfies ContentProvider
```

`capabilities.query.operators` and `capabilities.query.pagination` are runtime
truth. Unsupported operators, offset paging, cursor paging, and count queries
are rejected before provider dispatch. Count requires `offset`; a plain limit
does not require a pagination capability.

## Query wire

Providers receive a versioned, JSON-pure `ContentProviderQuery` containing:

- the lowered immutable query plan;
- the selected collection;
- `visibility.includeDrafts`, resolved from the request environment and preview
  authorization immediately before dispatch.

Providers must apply `visibility` to list, first, and count execution. Do not
recreate environment or preview policy inside the provider.

Return only canonical response envelopes:

- offset list: `{ result, skip, limit, total }`;
- cursor list: `{ mode: 'cursor', result, limit, pageInfo }` with no total;
- first: `{ result: document | undefined }`;
- count: `{ result: number }`.

Raw arrays, documents, numbers, and `undefined` are invalid responses.

## Raw documents

Query rows cross the provider boundary as `ProviderDocumentInput`:

```ts
const document = {
  collection: 'docs',
  canonicalKey: 'docs:intro',
  locale: 'de',
  contentPath: '/dokumentation/einstieg',
  routeVariants: [
    { locale: 'en', contentPath: '/docs/intro' },
    { locale: 'de', contentPath: '/dokumentation/einstieg' }
  ],
  body: { type: 'root', children: [] },
  title: 'Einstieg'
} satisfies ProviderDocumentInput
```

`contentPath` includes the locale-specific collection mount but not the Nuxt
locale prefix. `routeVariants` contains concrete variants only. Core owns
public URL projection, fallback alternates, and the final document envelope.
Providers must not return top-level `path`, `variants`, `localePaths`,
`resolved`, `route`, or `resolution` metadata.

`normalizeProviderDocument()` validates JSON purity and fills derivable `id`,
`canonicalKey`, and `type` values. `file` remains optional for remote content.

## Raw route facts

Every route-bearing optional operation returns a nested raw route fact:

```ts
{
  collection: 'docs',
  canonicalKey: 'docs:intro',
  locale: 'de',
  contentPath: '/dokumentation/einstieg'
}
```

Navigation items use `{ title, route, children? }`; surroundings use
`{ title, route }`; search results use `{ title, excerpt?, score, route }`.
`routes()` returns route facts plus optional `draft` and `sitemap` metadata.
Providers must never return projected `path`, `href`, `localePath`, or
`alternates` fields. Core applies consumer policy and URL projection once.

## Cache-aware results

Wrap any provider result with `withContentCache(data, hint)`. The marker is
private; use `isContentProviderResult()` when inspection is necessary.
Runtime consumers receive `data`, while Ginko merges the cache hint into the
request-local collector. Implement `invalidate()` when the provider owns a
backend cache.

## Executable conformance

`runProviderContractSuite()` requires one successful probe for every advertised
operator and pagination mode. Advertisements without executable probes fail the
suite.

```ts
runProviderContractSuite({
  name: 'custom provider',
  expectedProviderName: 'custom',
  loadProvider: async () => provider,
  createEvent,
  expectedCapabilities: provider.capabilities,
  operatorProbes: {
    $eq: { positive: toContentProviderQuery({ collection: 'docs', where: { title: { $eq: 'Intro' } } }) }
  },
  paginationProbes: {}
})
```

The suite also validates raw `routes()` output and proves optional operation
support comes from method presence.

## Verification

Run focused provider tests first, then the public gates:

```bash
pnpm vitest run test/contracts/provider-contracts.test.ts test/contracts/provider-fixture-conformance.test.ts test/contracts/filesystem-provider-conformance.test.ts
pnpm test
pnpm typecheck
pnpm lint
```

Update `meta/public-surface.json`, provider docs, generated server declarations,
and type fixtures whenever the public provider surface changes.
