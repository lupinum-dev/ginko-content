import type {
  BoundedContentProviderQuery,
  ContentDataSource,
} from '../public/data-source'
import type { ContentProviderSearchRequest } from '../types/search'
import type {
  ContentProviderSiteDataRequest,
  ContentProviderSurroundingsOptions,
} from '../public/provider-contract'
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

export interface ContentDataSourceCursorContractProbe {
  first: ContentDataSourceContractProbe
  next: (cursor: string) => ContentDataSourceContractProbe
}

export interface ContentDataSourceOptionalOperationProbes {
  navigation?: {
    query: BoundedContentProviderQuery
    assertResult: (result: unknown) => void | Promise<void>
  }
  surroundings?: {
    collection: string
    contentPath: string
    options?: ContentProviderSurroundingsOptions
    assertResult: (result: unknown) => void | Promise<void>
  }
  search?: {
    request: ContentProviderSearchRequest
    assertResult: (result: unknown) => void | Promise<void>
  }
  siteData?: {
    request: ContentProviderSiteDataRequest
    assertResult: (result: unknown) => void | Promise<void>
  }
  routes?: {
    assertResult: (result: unknown) => void | Promise<void>
  }
}

export interface ContentDataSourceContractSuiteOptions<Context> {
  name: string
  loadSource: () => Promise<ContentDataSource<Context>>
  createContext: () => Context
  firstFound: ContentDataSourceContractProbe
  firstMissing: ContentDataSourceContractProbe
  list: ContentDataSourceContractProbe
  count?: ContentDataSourceContractProbe
  cursor?: ContentDataSourceCursorContractProbe
  operations?: ContentDataSourceOptionalOperationProbes
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

  test(`${options.name} certifies count when offset pagination is advertised`, async () => {
    const source = await options.loadSource()
    const advertisesOffset = source.capabilities.query.pagination.includes('offset')
    expect(Boolean(options.count), 'Offset data sources require a count conformance probe').toBe(advertisesOffset)
    if (options.count) {
      expect(options.count.query.plan.mode).toBe('count')
      await executeProbe(options, options.count)
    }
  })

  if (options.cursor) {
    test(`${options.name} preserves opaque cursor continuation semantics`, async () => {
      const source = await options.loadSource()
      const context = options.createContext()
      const provider = bindContentProvider({ source, createContext: () => context })
      const event = { context: {}, node: { req: {}, res: {} } } as never
      const firstProbe = options.cursor!.first
      expect(firstProbe.query.plan.pagination.mode).toBe('cursor')
      const firstResponse = await provider.query(event, firstProbe.query)
      const first = isContentProviderResult(firstResponse) ? firstResponse.data : firstResponse
      assertQueryResponse(first, firstProbe.query)
      await firstProbe.assertResult(first)
      const cursor = (first as { pageInfo?: { endCursor?: unknown, hasNext?: unknown } }).pageInfo?.endCursor
      expect((first as { pageInfo?: { hasNext?: unknown } }).pageInfo?.hasNext).toBe(true)
      expect(typeof cursor).toBe('string')
      const nextProbe = options.cursor!.next(cursor as string)
      expect(nextProbe.query.plan.pagination.mode).toBe('cursor')
      if (nextProbe.query.plan.pagination.mode !== 'cursor') {
        throw new TypeError('Cursor continuation probe must use cursor pagination.')
      }
      expect(nextProbe.query.plan.pagination.after).toBe(cursor)
      const nextResponse = await provider.query(event, nextProbe.query)
      const next = isContentProviderResult(nextResponse) ? nextResponse.data : nextResponse
      assertQueryResponse(next, nextProbe.query)
      await nextProbe.assertResult(next)
    })
  }

  test(`${options.name} has discriminating probes for every optional operation`, async () => {
    const source = await options.loadSource()
    const probes = options.operations ?? {}
    for (const method of ['navigation', 'surroundings', 'search', 'siteData', 'routes'] as const) {
      expect(Boolean(probes[method]), `Missing conformance probe for implemented operation ${method}`).toBe(
        typeof source[method] === 'function'
      )
    }
  })

  const operations = options.operations
  if (operations?.navigation) {
    test(`${options.name} executes navigation`, async () => {
      const provider = bindContentProvider({ source: await options.loadSource(), createContext: options.createContext })
      const response = await provider.navigation!({ context: {}, node: { req: {}, res: {} } } as never, operations.navigation!.query)
      await operations.navigation!.assertResult(isContentProviderResult(response) ? response.data : response)
    })
  }
  if (operations?.surroundings) {
    test(`${options.name} executes surroundings`, async () => {
      const provider = bindContentProvider({ source: await options.loadSource(), createContext: options.createContext })
      const probe = operations.surroundings!
      const response = await provider.surroundings!(
        { context: {}, node: { req: {}, res: {} } } as never,
        probe.collection,
        probe.contentPath,
        probe.options,
      )
      await probe.assertResult(isContentProviderResult(response) ? response.data : response)
    })
  }
  if (operations?.search) {
    test(`${options.name} executes search`, async () => {
      const provider = bindContentProvider({ source: await options.loadSource(), createContext: options.createContext })
      const response = await provider.search!({ context: {}, node: { req: {}, res: {} } } as never, operations.search!.request)
      await operations.search!.assertResult(isContentProviderResult(response) ? response.data : response)
    })
  }
  if (operations?.siteData) {
    test(`${options.name} executes site data`, async () => {
      const provider = bindContentProvider({ source: await options.loadSource(), createContext: options.createContext })
      const response = await provider.siteData!({ context: {}, node: { req: {}, res: {} } } as never, operations.siteData!.request)
      await operations.siteData!.assertResult(isContentProviderResult(response) ? response.data : response)
    })
  }
  if (operations?.routes) {
    test(`${options.name} executes stable route enumeration`, async () => {
      const provider = bindContentProvider({ source: await options.loadSource(), createContext: options.createContext })
      const response = await provider.routes!({ context: {}, node: { req: {}, res: {} } } as never)
      await operations.routes!.assertResult(isContentProviderResult(response) ? response.data : response)
    })
  }
}
