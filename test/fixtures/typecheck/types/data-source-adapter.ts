import type { H3Event } from 'h3'
import {
  CONTENT_DATA_SOURCE_LIMITS,
  createContentDataSourceCacheHint,
  createContentDataSourceError,
  type BoundedContentProviderQuery,
  type ContentDataSource,
  type ContentDataSourceControl,
} from '@lupinum/ginko-content/data-source'
import { bindContentProvider } from '@lupinum/ginko-content/provider'

const cache = createContentDataSourceCacheHint({ tags: ['content:docs'], maxAge: 60 })
const unsupported = createContentDataSourceError('QUERY_UNSUPPORTED')
void [cache, unsupported]

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
