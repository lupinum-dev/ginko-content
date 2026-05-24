// @vitest-environment node

import { computed, effectScope, reactive, ref } from 'vue'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const route = reactive({
  path: '/docs/start',
  name: 'docs-slug',
  meta: {} as Record<string, unknown>
})
const setI18nParams = vi.fn()
const stateStore = new Map<string, ReturnType<typeof ref>>()

vi.mock('#imports', () => ({
  useRoute: () => route,
  useRouter: () => ({
    currentRoute: { value: route },
    resolve: (path: string) => ({
      path,
      name: 'docs-slug',
      params: { slug: path.split('/').filter(Boolean).at(-1) }
    })
  }),
  useState: (key: string, init?: () => unknown) => {
    if (!stateStore.has(key)) {
      stateStore.set(key, ref(init ? init() : undefined))
    }
    return stateStore.get(key)!
  }
}))

vi.mock('#app/composables/router', () => ({
  useRoute: () => route,
  useRouter: () => ({
    currentRoute: { value: route },
    resolve: (path: string) => ({
      path,
      name: 'docs-slug',
      params: { slug: path.split('/').filter(Boolean).at(-1) }
    })
  })
}))

vi.mock('#app/composables/state', () => ({
  useState: (key: string, init?: () => unknown) => {
    if (!stateStore.has(key)) {
      stateStore.set(key, ref(init ? init() : undefined))
    }
    return stateStore.get(key)!
  }
}))

vi.mock('#build/content-i18n.mjs', () => ({
  useRouteBaseName: () => (value: { name?: unknown }) => typeof value.name === 'string' ? value.name : undefined,
  useSetI18nParams: () => setI18nParams,
  useSwitchLocalePath: () => (locale: string) => `/fallback/${locale}`
}))

vi.mock('../../packages/content/src/runtime/app/composables/content-i18n', () => ({
  useRouteBaseName: () => (value: { name?: unknown }) => typeof value.name === 'string' ? value.name : undefined,
  useSetI18nParams: () => setI18nParams,
  useSwitchLocalePath: () => (locale: string) => `/fallback/${locale}`
}))

describe('content route metadata contracts', () => {
  beforeEach(() => {
    route.path = '/docs/start'
    route.name = 'docs-slug'
    route.meta = {}
    setI18nParams.mockReset()
    stateStore.clear()
  })

  test('publishes active localized route params and switch paths from real route metadata', async () => {
    const { useContentRoute, useContentSwitchLocalePath } = await import('../../packages/content/src/runtime/app/composables/route')
    const page = ref({
      path: '/docs/start',
      canonicalPath: '/docs/start',
      localePaths: {
        en: { path: '/docs/start', translated: true },
        de: { path: '/de/docs/startseite', translated: true }
      }
    })

    const scope = effectScope()
    let routeApi: ReturnType<typeof useContentRoute> | undefined
    let switchLocalePath: ReturnType<typeof useContentSwitchLocalePath> | undefined
    scope.run(() => {
      routeApi = useContentRoute(computed(() => page.value))
      switchLocalePath = useContentSwitchLocalePath()
    })

    expect(routeApi?.localePaths.value).toEqual({
      en: '/docs/start',
      de: '/de/docs/startseite'
    })
    expect(switchLocalePath?.('de')).toBe('/de/docs/startseite')
    expect(setI18nParams).toHaveBeenLastCalledWith({
      en: { slug: 'start' },
      de: { slug: 'startseite' }
    })

    scope.stop()
  })

  test('keeps content route metadata active when static hosting adds a trailing slash', async () => {
    const { useContentRoute, useContentSwitchLocalePath } = await import('../../packages/content/src/runtime/app/composables/route')
    route.path = '/docs/start/'
    const page = ref({
      path: '/docs/start',
      canonicalPath: '/docs/start',
      localePaths: {
        en: { path: '/docs/start', translated: true },
        de: { path: '/de/docs/startseite', translated: true }
      }
    })

    const scope = effectScope()
    let routeApi: ReturnType<typeof useContentRoute> | undefined
    let switchLocalePath: ReturnType<typeof useContentSwitchLocalePath> | undefined
    scope.run(() => {
      routeApi = useContentRoute(computed(() => page.value))
      switchLocalePath = useContentSwitchLocalePath()
    })

    expect(routeApi?.path.value).toBe('/docs/start')
    expect(switchLocalePath?.('de')).toBe('/de/docs/startseite')
    expect(setI18nParams).toHaveBeenLastCalledWith({
      en: { slug: 'start' },
      de: { slug: 'startseite' }
    })

    scope.stop()
  })
})
