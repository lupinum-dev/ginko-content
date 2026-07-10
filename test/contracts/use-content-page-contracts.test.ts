// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'

const route = reactive({
  path: '/docs/getting-started',
  query: {}
})
const fetchContentApi = vi.fn()
const asyncDataStates: Array<{
  data: ReturnType<typeof ref>
  pending: ReturnType<typeof ref<boolean>>
  status: ReturnType<typeof ref<string>>
  error: ReturnType<typeof ref<unknown>>
  refresh: ReturnType<typeof vi.fn>
}> = []

const createAsyncDataState = (value: unknown) => {
  const state = {
    data: ref(value),
    pending: ref(false),
    status: ref('success'),
    error: ref<unknown>(null),
    refresh: vi.fn(async () => {})
  }
  asyncDataStates.push(state)
  return state
}

vi.mock('#imports', () => ({
  useRoute: () => route,
  createError: (input: any) => Object.assign(new Error(input?.statusMessage || input?.message || 'Error'), input),
  useRequestFetch: () => vi.fn(),
  useRequestEvent: () => undefined,
  useAsyncData: async (_key: unknown, handler: () => Promise<unknown>) => createAsyncDataState(await handler())
}))

vi.mock('#app/composables/router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#app/composables/router')>()
  return {
    ...actual,
    useRoute: () => route
  }
})

vi.mock('#app/composables/error', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#app/composables/error')>()
  return {
    ...actual,
    createError: (input: any) => Object.assign(new Error(input?.statusMessage || input?.message || 'Error'), input)
  }
})

vi.mock('#app/composables/asyncData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#app/composables/asyncData')>()
  return {
    ...actual,
    useAsyncData: async (_key: unknown, handler: () => Promise<unknown>) => createAsyncDataState(await handler())
  }
})

vi.mock('../../packages/content/src/runtime/app/composables/runtime', () => ({
  getContentRuntime: () => ({
    api: { baseURL: '/api/_content' },
    collections: {
      docs: {
        route: '/docs',
        i18n: {
          defaultLocale: 'en',
          locales: ['en', 'de']
        }
      }
    },
    defaultLocale: 'en',
    locales: ['en', 'de'],
    localeFallback: { de: ['en'] },
    integrity: 'test'
  }),
  getContentRoute: () => route
}))

vi.mock('../../packages/content/src/runtime/app/composables/utils', () => ({
  fetchContentApi,
  getContentApiFetcher: () => vi.fn()
}))

vi.mock('../../packages/content/src/runtime/app/composables/preview', () => ({
  useContentPreview: () => ({
    getPreviewToken: () => undefined
  })
}))

const doc = (path = '/docs/getting-started') => ({
  path,
  locale: 'en',
  file: { path: `${path}.md` },
  resolved: {
    requestedRoute: path,
    locale: 'en',
    variantPaths: {
      en: path,
      de: path.replace('/docs/', '/de/docs/')
    }
  },
  title: path.endsWith('advanced') ? 'Advanced' : (path.endsWith('canonical') ? 'Aliased' : 'Getting Started')
})

// The real `pageAsync.data` ref only ever holds the decorated `LocalizedDoc`
// envelope `one()` returns. Tests that poke the mocked async-data ref
// directly (to simulate a settled route-change refetch) must poke it with
// this already-decorated shape, not the raw provider-shaped `doc()` fixture
// the transport mock above returns.
const decoratedDoc = (path: string) => ({
  ...doc(path),
  route: { requestedPath: path, resolvedPath: path, alternates: [] },
  resolution: { requested: { locale: 'en' }, resolved: { locale: 'en' }, usedFallback: false }
})

describe('useContentPage contracts', () => {
  beforeEach(() => {
    vi.resetModules()
    fetchContentApi.mockReset()
    asyncDataStates.length = 0
    route.path = '/docs/getting-started'
    fetchContentApi.mockImplementation(async (endpoint: string, params: Record<string, any>) => {
      if (endpoint === 'navigation') {
        return [
          { path: '/docs/intro', title: 'Intro' },
          { path: '/docs/getting-started', title: 'Getting Started' },
          { path: '/docs/advanced', title: 'Advanced' }
        ]
      }
      if (params.resolveVariant?.route === '/docs/missing') {
        return null
      }
      if (params.resolveVariant?.route === '/docs/alias') {
        return {
          ...doc('/docs/canonical'),
          resolved: {
            ...doc('/docs/canonical').resolved,
            requestedRoute: '/docs/alias'
          },
          title: 'Aliased'
        }
      }
      return doc(params.resolveVariant?.route || '/docs/getting-started')
    })
  })

  test('queries the current public route and returns the canonical document envelope', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content-page')

    const state = await useContentPage('docs')

    expect(fetchContentApi).toHaveBeenCalledWith('query', expect.objectContaining({
      collection: 'docs',
      first: true,
      resolveVariant: expect.objectContaining({
        route: '/docs/getting-started'
      })
    }), expect.anything())
    expect(state.page.value?.title).toBe('Getting Started')
    expect(state.page.value?.route.resolvedPath).toBe('/docs/getting-started')
    expect(state.page.value?.route.requestedPath).toBe('/docs/getting-started')
    expect(state.page.value?.resolution.resolved.locale).toBe('en')
    expect(state.page.value?.resolution.usedFallback).toBe(false)
    expect(state.previous.value).toBeNull()
    expect(state.next.value).toBeNull()
  })

  test('normalizes trailing slash route selectors for page queries', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content-page')
    route.path = '/docs/getting-started/'

    const state = await useContentPage('docs')

    expect(fetchContentApi).toHaveBeenCalledWith('query', expect.objectContaining({
      collection: 'docs',
      first: true,
      resolveVariant: expect.objectContaining({
        route: '/docs/getting-started'
      })
    }), expect.anything())
    expect(state.page.value?.title).toBe('Getting Started')
  })

  test('hides stale page data as soon as the route changes', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content-page')

    const state = await useContentPage('docs')
    expect(state.page.value?.title).toBe('Getting Started')

    route.path = '/docs/advanced'

    expect(state.page.value).toBeUndefined()
  })

  test('keeps statically served trailing-slash routes matched to the same page', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content-page')

    const state = await useContentPage('docs')
    expect(state.page.value?.title).toBe('Getting Started')

    route.path = '/docs/getting-started/'

    expect(state.page.value?.title).toBe('Getting Started')
  })

  test('does not throw or synthesize a 404 while a route change is settling', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content-page')

    const state = await useContentPage('docs')
    expect(state.page.value?.title).toBe('Getting Started')

    route.path = '/docs/advanced'
    await nextTick()

    expect(state.page.value).toBeUndefined()
    expect(state.error.value).toBeUndefined()

    asyncDataStates[0]!.data.value = null
    await nextTick()

    expect(state.page.value).toBeUndefined()
    expect(state.error.value).toBeUndefined()

    asyncDataStates[0]!.pending.value = true
    await nextTick()
    asyncDataStates[0]!.data.value = decoratedDoc('/docs/advanced')
    asyncDataStates[0]!.pending.value = false
    await nextTick()

    expect(state.page.value?.title).toBe('Advanced')
    expect(state.error.value).toBeUndefined()
  })

  test('never throws a default 404 — the application decides from an undefined page', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content-page')

    route.path = '/docs/missing'
    const state = await useContentPage('docs')

    expect(state.page.value).toBeUndefined()
    expect(state.error.value).toBeUndefined()
  })

  test('does not have a notFound option', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content-page')

    route.path = '/docs/missing'
    const state = await useContentPage('docs', {
      // @ts-expect-error `notFound` is not part of `UseContentPageOptions` (VNEXT.md 27.1).
      notFound: false
    })

    expect(state.page.value).toBeUndefined()
    expect(state.error.value).toBeUndefined()
  })

  test('keeps route-normalized matches whose requested route differs from the resolved canonical path', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content-page')

    route.path = '/docs/alias'
    const state = await useContentPage('docs')

    expect(state.page.value?.title).toBe('Aliased')
    expect(state.page.value?.route.resolvedPath).toBe('/docs/canonical')
    expect(state.page.value?.route.requestedPath).toBe('/docs/alias')
  })

  test('loads previous and next only when surround is enabled, via the select projection', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content-page')

    await useContentPage('docs')
    expect(fetchContentApi).not.toHaveBeenCalledWith('navigation', expect.anything(), expect.anything())

    fetchContentApi.mockClear()
    const state = await useContentPage('docs', {
      surround: {
        select: ['description']
      }
    })

    expect(fetchContentApi).toHaveBeenCalledWith('navigation', expect.anything(), expect.anything())
    expect(state.previous.value).toEqual(expect.objectContaining({ title: 'Intro' }))
    expect(state.next.value).toEqual(expect.objectContaining({ title: 'Advanced' }))
  })

  test('treats the collection root page as the first surround item', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content-page')

    route.path = '/docs'
    const state = await useContentPage('docs', {
      surround: true
    })

    expect(state.page.value?.title).toBe('Getting Started')
    expect(state.previous.value).toBeNull()
    expect(state.next.value).toEqual(expect.objectContaining({
      path: '/docs/intro',
      title: 'Intro'
    }))
  })
})
