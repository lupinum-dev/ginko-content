# Data-source adapter author guide

Use `@lupinum/ginko-content/data-source` when a CMS or remote store serves live
content. The data source is the pure, framework-free read contract. Use
`bindContentProvider` from `@lupinum/ginko-content/provider` only at the Nuxt/H3
edge to expose that source as a runtime `ContentProvider`.

## Ownership boundary

Ginko owns the fixed-shape query types, bounds, result envelopes, route facts,
cache-hint validation, public projection, and the Ginko portability codec. The
adapter owns its verified context and backend behavior. Persistence,
authorization, byte streaming, and retry policy stay in the adapter; do not
move those policies into Ginko or reconstruct portable document and manifest
shapes locally.

Create a verified context from the incoming request before calling the data
source. It should contain only facts that the adapter has authenticated and
authorized, such as tenant and actor identifiers. Never pass raw headers,
cookies, bearer tokens, or a caller-supplied tenant through as verified facts.

Every operation is bounded and fixed-shape. Honor `control.signal` and
`control.deadlineAt`, advertise only operations the backend implements, and
never fetch an unbounded roster to emulate pagination. Return the exact
`ContentDataSourceResult` envelope and use `false` when no cache hint exists.

## Complete minimal adapter

This exact example is typechecked by the repository. Its public imports are
also exercised by the packed-consumer gates.

```ts [data-source-adapter.ts]
import type { H3Event } from 'h3'
import {
  CONTENT_DATA_SOURCE_LIMITS,
  type BoundedContentProviderQuery,
  type ContentDataSource,
  type ContentDataSourceControl,
} from '@lupinum/ginko-content/data-source'
import { bindContentProvider } from '@lupinum/ginko-content/provider'

interface VerifiedContext {
  tenantId: string
  actorId: string
}

type QueryResult = Awaited<ReturnType<ContentDataSource<VerifiedContext>['query']>>

interface CmsBackend {
  query(input: {
    context: VerifiedContext
    query: BoundedContentProviderQuery
    control: ContentDataSourceControl
  }): Promise<QueryResult>
}

export function createCmsContentProvider(args: {
  backend: CmsBackend
  createVerifiedContext(event: H3Event): Promise<VerifiedContext>
}) {
  const source = {
    name: 'cms',
    capabilities: {
      protocol: 'ginko-content-data-source/v1',
      query: {
        operators: ['$eq'],
        pagination: ['offset'],
        maxPageSize: CONTENT_DATA_SOURCE_LIMITS.maxQueryPageSize,
      },
    },
    query(context, query, control) {
      return args.backend.query({ context, query, control })
    },
  } satisfies ContentDataSource<VerifiedContext>

  return bindContentProvider({
    source,
    createContext: args.createVerifiedContext,
  })
}
```

The backend method receives the already bounded public query and the verified
context. It should translate that query directly to one backend request. Add
`navigation`, `surroundings`, `search`, `siteData`, or cursor-paged `routes`
only when the backend implements the corresponding fixed result shape.

## Portable reads and writes

The data-source contract is read-only. When an adapter imports or exports
content, use `@lupinum/ginko-content/portability` and
`@lupinum/ginko-content/portability/node`; do not define another document,
frontmatter, manifest, identity, or hash model. Keep authorization,
transactions, receipts, cleanup, asset byte streaming, and retry semantics in
the adapter's operational layer.

## Evidence levels

Level 1 is protocol conformance. Run `runContentDataSourceContract` from
`@lupinum/ginko-content/testing/data-source-contract` with an adapter-owned
verified context. Add executable positive and negative probes for every
advertised capability. A passing Level 1 result proves the public protocol and
bounds only.

Level 2 is adapter-owned operational evidence. It must separately prove the
backend's authorization matrix, transaction or receipt behavior, retries,
crash recovery, scoped cleanup, concurrency, asset streaming, and deployment
limits. Never describe an adapter as operationally certified from Level 1
alone. Release evidence must name the adapter artifact hash and both sets of
results.

When runtime delivery is required, integrate the bound `ContentProvider` in
`content.config.ts`. Portability-only tools do not need a runtime provider.

## Test the packed artifact

Pack and install the adapter with the exact Ginko tarball in a fresh consumer,
without workspace resolution. Reject `workspace:`, `link:`, sibling-source,
registry fallback, peer warnings, and duplicate physical package resolutions.
Run typecheck, production build, Level 1 conformance, and the adapter-owned
Level 2 scenarios against those installed bytes.

## Production checklist

- The context is authenticated, authorized, adapter-owned, and request-scoped.
- Every advertised operation has positive and negative probes.
- Query, search, navigation, route, site-data, cache, error, and deadline bounds
  are enforced at the backend edge.
- Abort signals cancel backend work and no credential appears in cache keys,
  paths, asset URLs, results, or errors.
- Portable reads and writes use the Ginko portability codec and canonical hash.
- Persistence, authorization, streaming, receipts, cleanup, and retries have
  adapter-owned Level 2 evidence.
- Runtime delivery uses the separate `ContentProvider` integration.
- The exact packed artifact and dependency hashes are recorded with the
  conformance results.
