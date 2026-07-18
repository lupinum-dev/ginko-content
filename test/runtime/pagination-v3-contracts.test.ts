import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createInMemoryProvider } from '../harness/provider'
import { createSaasI18nScenario } from '../harness/scenarios'
import { createTestEvent } from '../harness/event'
import { encodeQueryParams } from '../../packages/content/src/runtime/utils/query'

const runtime = vi.hoisted(() => ({
  public: { content: {} },
  content: {}
}))

vi.stubGlobal('__ginkoTestRuntimeConfig', runtime)

const mocks = vi.hoisted(() => ({
  getContentProvider: vi.fn()
}))

vi.mock('../../packages/content/src/runtime/server/providers', () => ({
  getContentProvider: mocks.getContentProvider
}))

describe('provider query wire v3 — pagination and route candidates', () => {
  const scenario = createSaasI18nScenario()
  const provider = createInMemoryProvider(scenario)

  beforeEach(() => {
    runtime.content = scenario.runtime as never
    runtime.public.content = scenario.runtime as never
    mocks.getContentProvider.mockReset()
    mocks.getContentProvider.mockResolvedValue(provider)
  })

  test('the same query resolves as an honest offset page and an honest cursor page', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default

    const offsetEvent = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({
          collection: 'docs',
          resolveLocale: { locale: 'en', fallback: false },
          sort: [{ order: 1 }],
          paging: { mode: 'offset', skip: 0, limit: 1 }
        } as never)}`
      }
    })
    const offsetPage = await handler(offsetEvent) as {
      mode?: string
      result: unknown[]
      skip: number
      limit: number
      total: number
    }

    expect(offsetPage.mode === undefined || offsetPage.mode === 'offset').toBe(true)
    expect(offsetPage.result).toHaveLength(1)
    expect(typeof offsetPage.total).toBe('number')
    expect(offsetPage.total).toBeGreaterThan(1)

    const cursorEvent = createTestEvent({
      scenario,
      provider,
      params: {
        params: `docs/${encodeQueryParams({
          collection: 'docs',
          resolveLocale: { locale: 'en', fallback: false },
          sort: [{ order: 1 }],
          paging: { mode: 'cursor', after: null, limit: 1 }
        } as never)}`
      }
    })
    const cursorPage = await handler(cursorEvent) as {
      mode: string
      result: unknown[]
      limit: number
      pageInfo: { endCursor: string | null, hasNext: boolean }
    }

    expect(cursorPage.mode).toBe('cursor')
    expect(cursorPage.result).toHaveLength(1)
    expect('total' in cursorPage).toBe(false)
    expect('skip' in cursorPage).toBe(false)
    expect(cursorPage.pageInfo.hasNext).toBe(true)
    expect(typeof cursorPage.pageInfo.endCursor).toBe('string')

    // Both pages return the same first document — same query, two honest
    // paging descriptions of the same underlying result set.
    expect(cursorPage.result).toEqual(offsetPage.result)
  })

  test('an opaque cursor round-trips through the exact encode/decode pipeline the client HTTP transport uses', async () => {
    const handler = (await import('../../packages/content/src/runtime/server/api/query')).default
    const baseParams = {
      collection: 'docs',
      resolveLocale: { locale: 'en', fallback: false },
      sort: [{ order: 1 }]
    }

    const page1Event = createTestEvent({
      scenario,
      provider,
      params: { params: `docs/${encodeQueryParams({ ...baseParams, paging: { mode: 'cursor', after: null, limit: 1 } } as never)}` }
    })
    const page1 = await handler(page1Event) as { result: Array<{ route?: { resolvedPath?: string } }>, pageInfo: { endCursor: string | null, hasNext: boolean } }
    expect(page1.pageInfo.hasNext).toBe(true)
    const cursor = page1.pageInfo.endCursor
    expect(typeof cursor).toBe('string')

    // The application never parses `cursor` — it round-trips it verbatim
    // through the SAME base64 JSON codec (`encodeQueryParams`) the real
    // client transport uses to build the next request's URL segment.
    const page2Event = createTestEvent({
      scenario,
      provider,
      params: { params: `docs/${encodeQueryParams({ ...baseParams, paging: { mode: 'cursor', after: cursor, limit: 1 } } as never)}` }
    })
    const page2 = await handler(page2Event) as { result: Array<{ route?: { resolvedPath?: string } }>, pageInfo: { endCursor: string | null, hasNext: boolean } }

    expect(page2.result).toHaveLength(1)
    expect(page2.result[0]?.route?.resolvedPath).not.toBe(page1.result[0]?.route?.resolvedPath)
  })

  test('v3 route fallback candidates are ordered requested-locale-first, each with its own collection mount', async () => {
    const { createProviderQuery } = await import('../../packages/content/src/runtime/server/provider-query')

    // `docs` mounts `/dokumentation` in de and `/docs` in en (harness/scenarios.ts).
    // Requesting the German route with an English fallback must NOT reuse the
    // German mount's remainder for the English candidate.
    const query = createProviderQuery({
      collection: 'docs',
      resolveVariant: {
        route: '/dokumentation/essentials/fallback-lab',
        locale: 'de',
        fallback: ['en']
      }
    } as never)

    expect(query.plan.variantSelector).toMatchObject({
      by: 'route',
      requestedLocale: 'de'
    })
    const candidates = (query.plan.variantSelector as { candidates: Array<{ locale: string, contentPath: string }> }).candidates
    expect(candidates[0]).toMatchObject({ locale: 'de' })
    expect(candidates.map(candidate => candidate.locale)).toContain('en')
    // Each locale's candidate content path is projected through that locale's
    // OWN mount, not a shared/guessed one.
    for (const candidate of candidates) {
      expect(candidate.contentPath.startsWith('/dokumentation')).toBe(false)
      expect(candidate.contentPath.startsWith('/docs')).toBe(false)
    }
  })

  test('ref resolution sends an ordered locale chain instead of a raw locale/fallback pair', async () => {
    const { createProviderQuery } = await import('../../packages/content/src/runtime/server/provider-query')

    const query = createProviderQuery({
      collection: 'docs',
      resolveVariant: {
        ref: 'docs.getting-started',
        locale: 'de',
        fallback: ['en']
      }
    } as never)

    expect(query.plan.variantSelector).toEqual({
      by: 'ref',
      ref: 'docs.getting-started',
      requestedLocale: 'de',
      localeChain: ['de', 'en']
    })
  })

  test('route and ref selectors share one explicit, configured, or disabled fallback chain', async () => {
    const { createProviderQuery } = await import('../../packages/content/src/runtime/server/provider-query')
    runtime.content = {
      defaultLocale: 'en',
      locales: ['en', 'de', 'fr'],
      localeFallback: { de: ['fr'] },
      collections: {
        docs: {
          i18n: { defaultLocale: 'en', locales: ['en', 'de', 'fr'] },
          route: { en: '/docs', de: '/dokumentation', fr: '/documentation' }
        }
      }
    } as never

    const createQueries = (fallback: boolean | string[]) => ({
      route: createProviderQuery({
        collection: 'docs',
        resolveVariant: {
          route: '/de/dokumentation/intro',
          locale: 'de',
          fallback
        }
      } as never),
      ref: createProviderQuery({
        collection: 'docs',
        resolveVariant: {
          ref: 'docs.intro',
          locale: 'de',
          fallback
        }
      } as never)
    })
    const selectorLocales = (query: ReturnType<typeof createProviderQuery>) => {
      const selector = query.plan.variantSelector
      return selector?.by === 'route'
        ? selector.candidates.map(candidate => candidate.locale)
        : selector?.localeChain
    }

    const configured = createQueries(true)
    expect(configured.route.plan.resolveVariant?.fallback).toEqual(['fr', 'en'])
    expect(configured.ref.plan.resolveVariant?.fallback).toEqual(['fr', 'en'])
    expect(selectorLocales(configured.route)).toEqual(['de', 'fr', 'en'])
    expect(selectorLocales(configured.ref)).toEqual(['de', 'fr', 'en'])

    // The explicit chain overrides the configured de -> fr chain for both
    // selector kinds. Route closure must not reconstruct policy fallback.
    const explicit = createQueries(['en'])
    expect(explicit.route.plan.resolveVariant?.fallback).toEqual(['en'])
    expect(explicit.ref.plan.resolveVariant?.fallback).toEqual(['en'])
    expect(selectorLocales(explicit.route)).toEqual(['de', 'en'])
    expect(selectorLocales(explicit.ref)).toEqual(['de', 'en'])

    const disabled = createQueries(false)
    expect(disabled.route.plan.resolveVariant).toMatchObject({ exact: true })
    expect(disabled.ref.plan.resolveVariant).toMatchObject({ exact: true })
    expect(disabled.route.plan.resolveVariant).not.toHaveProperty('fallback')
    expect(disabled.ref.plan.resolveVariant).not.toHaveProperty('fallback')
    expect(selectorLocales(disabled.route)).toEqual(['de'])
    expect(selectorLocales(disabled.ref)).toEqual(['de'])
  })
})
