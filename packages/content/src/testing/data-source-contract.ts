import type {
  BoundedContentProviderQuery,
  ContentDataSource,
} from '../public/data-source'
import { bindContentProvider } from '../public/provider-binder'
import { isContentProviderResult } from '../public/provider'
import { normalizeProviderDocument, type ProviderDocumentInput } from '../public/provider-document'
import {
  isCanonicalCursorFindResponseEnvelope,
  isCanonicalOffsetFindResponseEnvelope
} from '../features/query/responses'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const assertDocuments = (value: unknown) => {
  const documents = Array.isArray(value) ? value : value === undefined ? [] : [value]
  for (const document of documents) normalizeProviderDocument(document as ProviderDocumentInput)
}

const assertQueryResponse = (response: unknown, query: BoundedContentProviderQuery) => {
  if (query.plan.mode === 'count') {
    if (
      !isRecord(response) ||
      Object.keys(response).length !== 1 ||
      !Number.isSafeInteger(response.result) ||
      (response.result as number) < 0
    ) {
      throw new TypeError('Content data source returned an invalid count response.')
    }
    return
  }
  if (query.plan.mode === 'first') {
    if (!isRecord(response) || Object.keys(response).length !== 1 || !('result' in response)) {
      throw new TypeError('Content data source returned an invalid first response.')
    }
    assertDocuments(response.result)
    return
  }
  const effectiveLimit = query.plan.paging?.limit ?? query.plan.limit
  const valid = query.plan.paging?.mode === 'cursor'
    ? isCanonicalCursorFindResponseEnvelope(response, { maxLimit: effectiveLimit })
    : isCanonicalOffsetFindResponseEnvelope(response, {
        expectedSkip: query.plan.paging?.mode === 'offset' ? query.plan.paging.skip : query.plan.skip,
        expectedLimit: effectiveLimit
      })
  if (!valid) throw new TypeError('Content data source returned an invalid list response.')
  assertDocuments((response as { result: unknown[] }).result)
}

export async function runContentDataSourceContract<Context>(args: {
  source: ContentDataSource<Context>
  context: Context
  query: BoundedContentProviderQuery
}): Promise<void> {
  const provider = bindContentProvider({ source: args.source, createContext: () => args.context })
  const event = { context: {}, node: { req: {}, res: {} } } as never
  const result = await provider.query(event, args.query)
  const data = isContentProviderResult(result) ? result.data : result
  assertQueryResponse(data, args.query)
}
