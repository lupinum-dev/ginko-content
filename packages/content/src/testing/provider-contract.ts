import { expect, test } from 'vitest'
import type {
  ContentProvider,
  ContentProviderCapabilities,
  ContentProviderQuery,
  ContentProviderResult
} from '../public/provider'
import { isContentProviderResult } from '../public/provider'
import { normalizeProviderRoutes } from '../runtime/server/provider-route-facts'

export interface ProviderQueryProbe {
  /** A query that must exercise the advertised feature and return successfully. */
  positive: ContentProviderQuery
  /** Optional provider-specific result assertion. */
  assertResult?: (result: unknown) => void | Promise<void>
}

export interface ProviderContractSuiteOptions {
  name: string
  expectedProviderName: string
  loadProvider: () => Promise<ContentProvider>
  createEvent: () => any
  expectedCapabilities: ContentProviderCapabilities
  /** One executable probe for every advertised operator. */
  operatorProbes: Partial<Record<string, ProviderQueryProbe>>
  /** One executable probe for every advertised pagination mode. */
  paginationProbes: Partial<Record<'offset' | 'cursor', ProviderQueryProbe>>
}

export const unwrapProviderContractResult = <T>(value: T | ContentProviderResult<T>): T =>
  isContentProviderResult<T>(value) ? value.data : value

export const expectProviderCapabilities = (
  provider: ContentProvider,
  expected: ContentProviderCapabilities
) => {
  expect(provider.capabilities).toEqual(expected)
  expect(Object.keys(provider.capabilities)).toEqual(['query'])
}

/**
 * Shared executable conformance for provider authors. Advertisements are not
 * snapshots: every operator and pagination mode must have a real probe.
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
      const result = unwrapProviderContractResult(await provider.query(createEvent(), probe!.positive))
      await probe!.assertResult?.(result)
    })
  }

  for (const mode of expectedCapabilities.query.pagination) {
    test(`${name} executes advertised ${mode} pagination`, async () => {
      const provider = await loadProvider()
      const probe = options.paginationProbes[mode]
      expect(probe, `Missing executable conformance probe for ${mode} pagination`).toBeDefined()
      const result = unwrapProviderContractResult(await provider.query(createEvent(), probe!.positive)) as unknown as Record<string, unknown>
      if (mode === 'cursor') {
        expect(result.mode).toBe('cursor')
        expect(result).not.toHaveProperty('total')
        expect(result.pageInfo).toEqual(expect.objectContaining({ hasNext: expect.any(Boolean) }))
      } else {
        expect(result.mode === undefined || result.mode === 'offset').toBe(true)
        expect(result.total).toEqual(expect.any(Number))
      }
      await probe!.assertResult?.(result)
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
    for (const method of ['navigation', 'surroundings', 'search', 'siteData', 'routes', 'invalidate'] as const) {
      if (method in provider) expect(provider[method]).toBeTypeOf('function')
    }
  })
}
