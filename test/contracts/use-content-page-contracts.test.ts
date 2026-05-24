// @vitest-environment node

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'

const route = reactive({
  path: '/docs/getting-started',
  query: {}
})

const fetchContentApi = vi.fn()
const showError = vi.fn()
const useContentRoute = vi.fn()
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
  useRouter: () => ({
    currentRoute: { value: { meta: {}, path: route.path } },
    resolve: (path: string) => ({ path, params: {}, meta: {}, name: 'docs' })
  }),
  useState: (_key: string, init?: () => unknown) => ref(init ? init() : undefined),
  createError: (input: any) => Object.assign(new Error(input?.statusMessage || input?.message || 'Error'), input),
  showError,
  useRequestFetch: () => vi.fn(),
  useRequestEvent: () => undefined,
  useAsyncData: async (_key: unknown, handler: () => Promise<unknown>) => createAsyncDataState(await handler())
}))

vi.mock('#app/composables/router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#app/composables/router')>()
  return {
    ...actual,
    useRoute: () => route,
    useRouter: () => ({
      currentRoute: { value: { meta: {}, path: route.path } },
      resolve: (path: string) => ({ path, params: {}, meta: {}, name: 'docs' })
    })
  }
})

vi.mock('#app/composables/error', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#app/composables/error')>()
  return {
    ...actual,
    createError: (input: any) => Object.assign(new Error(input?.statusMessage || input?.message || 'Error'), input),
    showError
  }
})

vi.mock('#app/composables/asyncData', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#app/composables/asyncData')>()
  return {
    ...actual,
    useAsyncData: async (_key: unknown, handler: () => Promise<unknown>) => createAsyncDataState(await handler())
  }
})

vi.mock('#build/content-i18n.mjs', () => ({
  useRouteBaseName: () => () => 'docs',
  useSetI18nParams: () => vi.fn(),
  useSwitchLocalePath: () => (locale: string) => `/fallback/${locale}`
}))

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
  })
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

vi.mock('../../packages/content/src/runtime/app/composables/route', () => ({
  useContentRoute,
  useContentSwitchLocalePath: () => () => ''
}))

const doc = (path = '/docs/getting-started') => ({
  _path: path,
  _file: `${path}.md`,
  _requestedRoute: path,
  _variantPaths: {
    en: path,
    de: path.replace('/docs/', '/de/docs/')
  },
  title: path.endsWith('advanced') ? 'Advanced' : 'Getting Started'
})

describe('useContentPage contracts', () => {
  beforeEach(() => {
    vi.resetModules()
    fetchContentApi.mockReset()
    showError.mockReset()
    useContentRoute.mockReset()
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
          _requestedRoute: '/docs/alias',
          title: 'Aliased'
        }
      }
      return doc(params.resolveVariant?.route || '/docs/getting-started')
    })
  })

  test('queries the current public route and publishes route metadata', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content')

    const state = await useContentPage('docs')

    expect(fetchContentApi).toHaveBeenCalledWith('query', expect.objectContaining({
      collection: 'docs',
      first: true,
      resolveVariant: expect.objectContaining({
        route: '/docs/getting-started'
      })
    }), expect.anything())
    expect(state.page.value?.title).toBe('Getting Started')
    expect(state.surround.value).toEqual([])
    expect(useContentRoute).toHaveBeenCalledWith(state.page)
  })

  test('normalizes trailing slash route selectors for page queries', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content')
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

  test('uses the public route resolver for non-i18n route pages too', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content')

    route.path = '/plain/about'
    const state = await useContentPage('plain')

    expect(fetchContentApi).toHaveBeenCalledWith('query', expect.objectContaining({
      collection: 'plain',
      first: true,
      resolveVariant: expect.objectContaining({
        route: '/plain/about'
      })
    }), expect.anything())
    expect(state.page.value?._path).toBe('/plain/about')
  })

  test('keeps the page reactive when route metadata reads it before async data resolves', async () => {
    useContentRoute.mockImplementation((pageRef) => {
      void pageRef.value
    })
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content')

    const state = await useContentPage('docs')

    expect(state.page.value?.title).toBe('Getting Started')
  })

  test('hides stale page data as soon as the route changes', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content')

    const state = await useContentPage('docs')
    expect(state.page.value?.title).toBe('Getting Started')

    route.path = '/docs/advanced'

    expect(state.page.value).toBeUndefined()
  })

  test('keeps statically served trailing-slash routes matched to the same page', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content')

    const state = await useContentPage('docs')
    expect(state.page.value?.title).toBe('Getting Started')

    route.path = '/docs/getting-started/'

    expect(state.page.value?.title).toBe('Getting Started')
  })

  test('normalizes trailing slash route selectors for locale switch queries', async () => {
    const { useContentLocaleSwitch } = await import('../../packages/content/src/runtime/app/composables/use-content')
    route.path = '/docs/getting-started/'

    const state = await useContentLocaleSwitch('docs', {
      locale: 'en',
      by: {
        route: () => route.path
      },
      fallback: true
    })

    expect(fetchContentApi).toHaveBeenCalledWith('query', expect.objectContaining({
      collection: 'docs',
      first: true,
      resolveVariant: expect.objectContaining({
        route: '/docs/getting-started'
      })
    }), expect.anything())
    expect(state.switchTo('de')).toBeTruthy()
  })

  test('does not report 404 during client-side route settling before new data arrives', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content')

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
    asyncDataStates[0]!.data.value = doc('/docs/getting-started')
    asyncDataStates[0]!.pending.value = false
    await nextTick()

    expect(state.page.value).toBeUndefined()
    expect(state.error.value).toBeUndefined()

    asyncDataStates[0]!.pending.value = true
    await nextTick()
    asyncDataStates[0]!.data.value = doc('/docs/advanced')
    asyncDataStates[0]!.pending.value = false
    await nextTick()

    expect(state.page.value?.title).toBe('Advanced')
    expect(state.error.value).toBeUndefined()
  })

  test('reports a client-side 404 after the route query settles without a page', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content')

    const state = await useContentPage('docs')
    route.path = '/docs/missing'
    await nextTick()

    asyncDataStates[0]!.data.value = null
    await nextTick()
    expect(state.error.value).toBeUndefined()

    asyncDataStates[0]!.pending.value = true
    await nextTick()
    asyncDataStates[0]!.pending.value = false
    await nextTick()

    expect(state.error.value).toMatchObject({
      statusCode: 404,
      statusMessage: 'Page not found'
    })
  })

  test('keeps resolver matches whose requested route differs from canonical path', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content')

    route.path = '/docs/alias'
    const state = await useContentPage('docs')

    expect(state.page.value?.title).toBe('Aliased')
    expect(state.page.value?.path).toBe('/docs/canonical')
    expect(state.page.value?.resolved.requestedRoute).toBe('/docs/alias')
  })

  test('throws default and custom not-found errors, unless notFound is false', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content')

    route.path = '/docs/missing'
    await expect(useContentPage('docs')).rejects.toMatchObject({
      statusCode: 404,
      statusMessage: 'Page not found',
      fatal: true
    })
    await expect(useContentPage('docs', {
      notFound: () => ({ statusCode: 410, statusMessage: 'Gone', fatal: true })
    })).rejects.toMatchObject({
      statusCode: 410,
      statusMessage: 'Gone',
      fatal: true
    })

    const state = await useContentPage('docs', { notFound: false })
    expect(state.page.value).toBeUndefined()
    expect(state.error.value).toBeUndefined()
  })

  test('loads neighbors only when surround is enabled', async () => {
    const { useContentPage } = await import('../../packages/content/src/runtime/app/composables/use-content')

    await useContentPage('docs')
    expect(fetchContentApi).not.toHaveBeenCalledWith('navigation', expect.anything(), expect.anything())

    fetchContentApi.mockClear()
    const state = await useContentPage('docs', {
      surround: {
        fields: ['description']
      }
    })

    expect(fetchContentApi).toHaveBeenCalledWith('navigation', expect.objectContaining({
      collection: 'docs',
      only: expect.arrayContaining(['description'])
    }), expect.anything())
    expect(state.surround.value).toEqual([
      expect.objectContaining({ title: 'Intro' }),
      expect.objectContaining({ title: 'Advanced' })
    ])
  })
})
