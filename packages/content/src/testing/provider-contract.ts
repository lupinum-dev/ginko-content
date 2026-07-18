import { expect, test } from 'vitest'
import type {
  ContentProvider,
  ContentProviderCapabilities,
  ContentProviderQuery,
  ContentProviderResult
} from '../public/provider'
import type { FilterExpr } from '../core/query/plan'
import { isContentProviderResult } from '../public/provider'
import { normalizeProviderDocument, type ProviderDocumentInput } from '../public/provider-document'
import {
  isCanonicalCursorFindResponseEnvelope,
  isCanonicalOffsetFindResponseEnvelope
} from '../features/query/responses'
import { normalizeProviderRoutes } from '../runtime/server/provider-route-facts'

export interface ProviderQueryProbe {
  /** A query that must exercise the advertised feature and return successfully. */
  positive: ContentProviderQuery
  /** Required discriminating assertion: an implementation that ignores the feature must fail. */
  assertResult: (result: unknown) => void | Promise<void>
}

export type ProviderLogicalFilterNode = 'and' | 'or' | 'not'

export interface ProviderLogicalQueryProbe extends ProviderQueryProbe {
  /** Required because successful dispatch alone does not prove logical semantics. */
  assertResult: (result: unknown) => void | Promise<void>
}

export interface ProviderContractSuiteOptions {
  name: string
  expectedProviderName: string
  loadProvider: () => Promise<ContentProvider>
  createEvent: () => any
  expectedCapabilities: ContentProviderCapabilities
  /** One executable probe for every advertised comparison operator. */
  operatorProbes: Partial<Record<string, ProviderQueryProbe>>
  /** Result-asserting probes for the mandatory structural filter nodes. */
  logicalProbes: Record<ProviderLogicalFilterNode, ProviderLogicalQueryProbe>
  /** One executable probe for every advertised pagination mode. */
  paginationProbes: Partial<Record<'offset' | 'cursor', ProviderQueryProbe>>
  /** A discriminating probe for provider-owned ordering semantics. */
  sortProbe: ProviderQueryProbe
  /** First is mandatory; count is required when offset pagination is advertised. */
  terminalProbes: { first: ProviderQueryProbe, count?: ProviderQueryProbe }
}

const filterContainsNode = (filter: FilterExpr, type: ProviderLogicalFilterNode): boolean => {
  if (filter.type === type) return true
  if (filter.type === 'and' || filter.type === 'or') {
    return filter.clauses.some(clause => filterContainsNode(clause, type))
  }
  if (filter.type === 'not') return filterContainsNode(filter.clause, type)
  return false
}

const filterContainsOperator = (filter: FilterExpr, operator: string): boolean => {
  if (filter.type === 'compare') return `$${filter.operator}` === operator
  if (filter.type === 'and' || filter.type === 'or') {
    return filter.clauses.some(clause => filterContainsOperator(clause, operator))
  }
  if (filter.type === 'not') return filterContainsOperator(filter.clause, operator)
  return false
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const expectProviderDocuments = (value: unknown) => {
  const documents = Array.isArray(value) ? value : value === undefined ? [] : [value]
  for (const document of documents) {
    expect(() => normalizeProviderDocument(document as ProviderDocumentInput)).not.toThrow()
  }
}

const expectCanonicalProviderQueryResponse = (response: unknown, query: ContentProviderQuery) => {
  if (query.plan.mode === 'count') {
    expect(isRecord(response)).toBe(true)
    expect(Object.keys(response as Record<string, unknown>)).toEqual(['result'])
    const result = (response as Record<string, unknown>).result
    expect(Number.isSafeInteger(result) && (result as number) >= 0).toBe(true)
    return
  }

  if (query.plan.mode === 'first') {
    expect(isRecord(response)).toBe(true)
    expect(Object.keys(response as Record<string, unknown>)).toEqual(['result'])
    const result = (response as Record<string, unknown>).result
    expectProviderDocuments(result)
    return
  }

  const limit = query.plan.paging?.limit ?? query.plan.limit
  expect(limit).toEqual(expect.any(Number))
  if (query.plan.paging?.mode === 'cursor') {
    expect(isCanonicalCursorFindResponseEnvelope(response, { maxLimit: limit })).toBe(true)
  } else {
    expect(isCanonicalOffsetFindResponseEnvelope(response, {
      expectedSkip: query.plan.paging?.mode === 'offset'
        ? query.plan.paging.skip
        : query.plan.skip,
      expectedLimit: limit
    })).toBe(true)
  }
  expectProviderDocuments((response as { result: unknown[] }).result)
}

export const unwrapProviderContractResult = <T>(value: T | ContentProviderResult<T>): T =>
  isContentProviderResult<T>(value) ? value.data : value

export const expectProviderCapabilities = (
  provider: ContentProvider,
  expected: ContentProviderCapabilities
) => {
  expect(provider.capabilities.query.pagination).toEqual(expected.query.pagination)
  expect(new Set(provider.capabilities.query.operators)).toEqual(new Set(expected.query.operators))
  expect(Object.keys(provider.capabilities)).toEqual(['query'])
}

/**
 * Shared executable conformance for provider authors. Advertisements are not
 * snapshots: every advertised comparison operator and pagination mode must
 * have a real probe.
 */
export const runProviderContractSuite = (options: ProviderContractSuiteOptions) => {
  const { name, expectedProviderName, loadProvider, createEvent, expectedCapabilities } = options

  test(`${name} exposes only semantic query capabilities`, async () => {
    const provider = await loadProvider()
    expect(provider.name).toBe(expectedProviderName)
    expectProviderCapabilities(provider, expectedCapabilities)
  })

  for (const operator of expectedCapabilities.query.operators) {
    test(`${name} executes advertised operator ${operator}`, async () => {
      const provider = await loadProvider()
      const probe = options.operatorProbes[operator]
      expect(probe, `Missing executable conformance probe for ${operator}`).toBeDefined()
      expect(
        filterContainsOperator(probe!.positive.plan.filter, operator),
        `Operator ${operator} probe must contain that comparison operator`
      ).toBe(true)
      const result = unwrapProviderContractResult(await provider.query(createEvent(), probe!.positive))
      expectCanonicalProviderQueryResponse(result, probe!.positive)
      await probe!.assertResult(result)
    })
  }

  for (const type of ['and', 'or', 'not'] as const) {
    test(`${name} executes structural ${type} filter nodes`, async () => {
      const provider = await loadProvider()
      const probe = options.logicalProbes[type]
      expect(filterContainsNode(probe.positive.plan.filter, type), `Logical ${type} probe must contain a ${type} filter node`).toBe(true)
      const result = unwrapProviderContractResult(await provider.query(createEvent(), probe.positive))
      expectCanonicalProviderQueryResponse(result, probe.positive)
      await probe.assertResult(result)
    })
  }

  test(`${name} executes ordered queries`, async () => {
    const provider = await loadProvider()
    const probe = options.sortProbe
    expect(probe.positive.plan.sort.length, 'Sort probe must contain at least one sort clause').toBeGreaterThan(0)
    const result = unwrapProviderContractResult(await provider.query(createEvent(), probe.positive))
    expectCanonicalProviderQueryResponse(result, probe.positive)
    await probe.assertResult(result)
  })

  const terminalModes = [
    'first',
    ...(expectedCapabilities.query.pagination.includes('offset') ? ['count' as const] : [])
  ] as const
  for (const mode of terminalModes) {
    test(`${name} executes ${mode} terminal queries`, async () => {
      const provider = await loadProvider()
      const probe = options.terminalProbes[mode]
      expect(probe, `Missing executable conformance probe for ${mode} terminal mode`).toBeDefined()
      expect(probe!.positive.plan.mode, `${mode} probe must explicitly select that terminal mode`).toBe(mode)
      const result = unwrapProviderContractResult(await provider.query(createEvent(), probe!.positive))
      expectCanonicalProviderQueryResponse(result, probe!.positive)
      await probe!.assertResult(result)
    })
  }

  for (const mode of expectedCapabilities.query.pagination) {
    test(`${name} executes advertised ${mode} pagination`, async () => {
      const provider = await loadProvider()
      const probe = options.paginationProbes[mode]
      expect(probe, `Missing executable conformance probe for ${mode} pagination`).toBeDefined()
      expect(probe!.positive.plan.paging?.mode, `${mode} pagination probe must explicitly select that mode`).toBe(mode)
      const result = unwrapProviderContractResult(await provider.query(createEvent(), probe!.positive))
      expectCanonicalProviderQueryResponse(result, probe!.positive)
      await probe!.assertResult(result)
    })
  }

  test(`${name} returns validated raw route records when routes() is present`, async () => {
    const provider = await loadProvider()
    if (!provider.routes) return
    const routes = normalizeProviderRoutes(
      unwrapProviderContractResult(await provider.routes(createEvent())),
      provider.name
    )
    for (const route of routes) {
      expect(route.contentPath.startsWith('/')).toBe(true)
      expect(route).not.toHaveProperty('path')
      expect(route).not.toHaveProperty('href')
    }
  })

  test(`${name} infers optional operation support from method presence`, async () => {
    const provider = await loadProvider()
    for (const method of ['navigation', 'surroundings', 'search', 'siteData', 'routes'] as const) {
      if (method in provider) expect(provider[method]).toBeTypeOf('function')
    }
  })
}
