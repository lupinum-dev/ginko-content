import type {
  BoundedContentProviderQuery,
  ContentDataSource,
} from '../public/data-source'
import { expect, test } from 'vitest'
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
  const effectiveLimit = query.plan.pagination.limit
  const valid = query.plan.pagination.mode === 'cursor'
    ? isCanonicalCursorFindResponseEnvelope(response, { maxLimit: effectiveLimit })
    : isCanonicalOffsetFindResponseEnvelope(response, {
        expectedSkip: query.plan.pagination.skip,
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

export interface ContentDataSourceContractProbe {
  query: BoundedContentProviderQuery
  assertResult: (result: unknown) => void | Promise<void>
}

export interface ContentDataSourceContractSuiteOptions<Context> {
  name: string
  loadSource: () => Promise<ContentDataSource<Context>>
  createContext: () => Context
  firstFound: ContentDataSourceContractProbe
  firstMissing: ContentDataSourceContractProbe
  list: ContentDataSourceContractProbe
  cursor?: ContentDataSourceContractProbe
}

const executeProbe = async <Context>(
  options: ContentDataSourceContractSuiteOptions<Context>,
  probe: ContentDataSourceContractProbe,
) => {
  const source = await options.loadSource()
  const context = options.createContext()
  const provider = bindContentProvider({ source, createContext: () => context })
  const event = { context: {}, node: { req: {}, res: {} } } as never
  const response = await provider.query(event, probe.query)
  const result = isContentProviderResult(response) ? response.data : response
  assertQueryResponse(result, probe.query)
  await probe.assertResult(result)
}

/**
 * Executable baseline for third-party data sources. Core-owned rejection,
 * timeout, cache, and route-enumeration invariants remain covered by the
 * binder contract so adapters do not need to reimplement them.
 */
export function runContentDataSourceContractSuite<Context>(
  options: ContentDataSourceContractSuiteOptions<Context>,
): void {
  for (const [label, probe] of [
    ['returns a found first result', options.firstFound],
    ['returns undefined for a missing provider-level first result', options.firstMissing],
    ['returns a canonical list result', options.list],
  ] as const) {
    test(`${options.name} ${label}`, async () => {
      expect(probe.query.plan.mode).toBe(label.includes('first result') ? 'first' : 'all')
      await executeProbe(options, probe)
    })
  }

  if (options.cursor) {
    test(`${options.name} preserves cursor pagination semantics`, async () => {
      expect(options.cursor!.query.plan.pagination.mode).toBe('cursor')
      await executeProbe(options, options.cursor!)
    })
  }
}
