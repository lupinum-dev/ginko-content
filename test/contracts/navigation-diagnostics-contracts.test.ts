import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { buildContentGraph } from '../../packages/content/src/core/content/graph'
import { toContentProviderNavigationQuery } from '../../packages/content/src/public/provider-query'
import { createTestEvent } from '../support/provider-scenarios/event'
import { doc } from '../support/content-documents'
import { fromContentProviderQueryPlan } from '../../packages/content/src/features/query/query-plan-boundary'

const localePolicy = {
  localized: true,
  locales: ['en', 'de'],
  defaultLocale: 'en',
  fallback: {},
  translatedSlugs: false,
  routeMounts: { en: '/', de: '/' }
}

const runtimeConfig = {
  content: {
    navigation: { fields: [] },
    defaultLocale: 'en',
    localeFallback: {},
    collections: {} as Record<string, { schemaFields?: string[], localePolicy?: typeof localePolicy }>
  }
}

const getContentGraph = vi.fn()
const resolveLocaleChain = vi.fn()
const isPreview = vi.fn()
const resolveRuntimeEnvironment = vi.fn()

const useGraph = (documents: any[]) => {
  const normalized = documents.map(document => ({
    partial: document.navigationFile ? true : false,
    ...(!document.navigationFile ? { collection: document.collection || 'docs' } : {}),
    ...document
  }))
  getContentGraph.mockResolvedValue(buildContentGraph(normalized, {
    locales: ['en', 'de'],
    defaultLocale: 'en'
  }))
}

describe('navigation diagnostics contracts', () => {
  beforeEach(() => {
    vi.resetModules()
    getContentGraph.mockReset()
    getContentGraph.mockResolvedValue(buildContentGraph([], { locales: [], defaultLocale: '' }))
    resolveLocaleChain.mockReset()
    resolveLocaleChain.mockReturnValue(['en'])
    isPreview.mockReset()
    isPreview.mockReturnValue(false)
    resolveRuntimeEnvironment.mockReset()
    resolveRuntimeEnvironment.mockReturnValue('development')
    runtimeConfig.content.collections = {}

    vi.doMock('../../packages/content/src/runtime/server/runtime-config', () => ({
      getContentRuntimeConfig: () => runtimeConfig
    }))
    vi.doMock('../../packages/content/src/storage/graph', async () => {
      const actual = await vi.importActual<any>('../../packages/content/src/storage/graph')
      return { ...actual, getContentGraph }
    })
    vi.doMock('../../packages/content/src/core/content/locale', async () => {
      const actual = await vi.importActual<any>('../../packages/content/src/core/content/locale')
      return { ...actual, resolveLocaleChain }
    })
    vi.doMock('../../packages/content/src/integrations/nitro/preview', () => ({ isPreview }))
    vi.doMock('../../packages/content/src/core/visibility', async () => {
      const actual = await vi.importActual<any>('../../packages/content/src/core/visibility')
      return { ...actual, resolveRuntimeEnvironment }
    })
  })

  const resolveNavigation = async (wire: ReturnType<typeof toContentProviderNavigationQuery>) => {
    const { resolveContentNavigation } = await import('../../packages/content/src/runtime/server/navigation-query')
    return resolveContentNavigation(createTestEvent(), {
      collection: wire.collection!,
      plan: fromContentProviderQueryPlan(wire.plan, wire.collection, localePolicy)
    })
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('warns once for select fields outside derived schema membership and shared vocabulary', async () => {
    runtimeConfig.content.collections = {
      docs: { schemaFields: ['title', 'summary'], localePolicy }
    }
    useGraph([
      doc({
        id: 'content:en:docs:intro.md',
        collection: 'docs',
        canonicalKey: 'intro',
        path: '/docs/intro',
        title: 'Intro'
      })
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wire = toContentProviderNavigationQuery({
      collection: 'docs',
      only: ['title', 'summary', 'badge', 'sidebar', 'sidbar']
    } as any)

    await resolveNavigation(wire)
    await resolveNavigation(wire)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('Navigation select field "sidbar"')
    expect(warn.mock.calls[0]![0]).not.toContain('summary')
    expect(warn.mock.calls[0]![0]).not.toContain('badge')
    expect(warn.mock.calls[0]![0]).not.toContain('sidebar')
  })

  test('does not emit request diagnostics in production runtime', async () => {
    runtimeConfig.content.collections = {
      docs: { schemaFields: ['title'], localePolicy }
    }
    useGraph([
      doc({
        id: 'content:en:docs:intro.md',
        collection: 'docs',
        canonicalKey: 'intro',
        path: '/docs/intro',
        title: 'Intro'
      })
    ])
    resolveRuntimeEnvironment.mockReturnValue('production')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wire = toContentProviderNavigationQuery({
      collection: 'docs',
      only: ['unknownProductionField']
    } as any)

    await resolveNavigation(wire)

    expect(warn).not.toHaveBeenCalled()
  })

  test('matches sidecars against all trees in the requested locale and deduplicates warnings', async () => {
    runtimeConfig.content.collections = {
      docs: { localePolicy }
    }
    useGraph([
      doc({
        id: 'content:en:docs:intro.md',
        collection: 'docs',
        canonicalKey: 'docs/intro',
        path: '/docs/intro',
        locale: 'en',
        title: 'Intro'
      }),
      doc({
        id: 'content:en:docs:root-navigation.yml',
        type: 'yaml',
        navigationFile: true,
        partial: true,
        path: '/',
        locale: 'en',
        file: { path: '/en/.navigation.yml' },
        body: { title: 'Root' }
      } as any),
      doc({
        id: 'content:en:data:missing.yml',
        type: 'yaml',
        partial: false,
        path: '/missing/record',
        locale: 'en',
        title: 'Data record'
      }),
      doc({
        id: 'content:en:blog:post.md',
        collection: 'blog',
        canonicalKey: 'blog/post',
        path: '/blog/post',
        locale: 'en',
        title: 'Post'
      }),
      doc({
        id: 'content:en:blog:.navigation.yml',
        type: 'yaml',
        navigationFile: true,
        partial: true,
        path: '/blog/',
        locale: 'en',
        file: { path: '/en/blog/.navigation.yml' },
        body: { title: 'Blog' }
      } as any),
      doc({
        id: 'content:en:missing:.navigation.yml',
        type: 'yaml',
        navigationFile: true,
        partial: true,
        path: '/missing',
        locale: 'en',
        file: { path: '/en/missing/.navigation.yml' },
        body: { title: 'Missing' }
      } as any),
      doc({
        id: 'content:de:missing:.navigation.yml',
        type: 'yaml',
        navigationFile: true,
        partial: true,
        path: '/fehlt',
        locale: 'de',
        file: { path: '/de/fehlt/.navigation.yml' },
        body: { title: 'Fehlt' }
      } as any)
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const wire = toContentProviderNavigationQuery({
      collection: 'docs',
      resolveLocale: { locale: 'en', exact: true }
    })

    await resolveNavigation(wire)
    await resolveNavigation(wire)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('/en/missing/.navigation.yml')
    expect(warn.mock.calls[0]![0]).not.toContain('/en/.navigation.yml')
    expect(warn.mock.calls[0]![0]).not.toContain('/en/blog/.navigation.yml')
    expect(warn.mock.calls[0]![0]).not.toContain('/de/fehlt/.navigation.yml')
  })

  test('enables diagnostics for development and prerender, but not production requests', async () => {
    const { shouldEmitRuntimeDiagnostics } = await import('../../packages/content/src/core/runtime-diagnostics')

    expect(shouldEmitRuntimeDiagnostics('development', false)).toBe(true)
    expect(shouldEmitRuntimeDiagnostics('production', true)).toBe(true)
    expect(shouldEmitRuntimeDiagnostics('production', false)).toBe(false)
  })
})
