import { beforeEach, describe, expect, test, vi } from 'vitest'
import { computed, reactive, shallowRef } from 'vue'
import type { ContentDocumentRoute, LocalizedDoc } from '../../packages/content/src/types/query'
import type { ContentPageStatus } from '../../packages/content/src/runtime/app/composables/use-content-page'

const router = { resolve: vi.fn((location: { path: string, query: unknown, hash: string }) => ({ fullPath: location.path })) }
const route = reactive({ path: '/de/einstieg', query: { q: 'a & b' }, hash: '#install' })
vi.mock('#imports', () => ({
  useRoute: () => route,
  useRouter: () => router,
  useRuntimeConfig: () => ({ public: { content: { locales: ['en', 'de', 'fr'] } } })
}))

const { useContentLocalePath } = await import('../../packages/content/src/runtime/app/composables/use-content-locale-path')
const facts = (): ContentDocumentRoute => ({
  requestedPath: '/de/einstieg',
  resolvedPath: '/de/einstieg',
  alternates: [
    { locale: 'de', path: '/de/einstieg', source: 'variant' },
    { locale: 'en', path: '/guide/start', source: 'variant' }
  ]
})
function pageResult() {
  const document = shallowRef<LocalizedDoc<unknown> | null>({ route: facts(), locale: 'de', resolution: {
    requested: { locale: 'de' }, resolved: { locale: 'de' }, usedFallback: false
  } })
  const status = shallowRef<ContentPageStatus>('success')
  return { document, status, result: { page: computed(() => document.value), status: computed(() => status.value) } }
}

describe('content locale links', () => {
  beforeEach(() => { route.path = '/de/einstieg'; route.hash = '#install' })

  test('uses proven translated paths and router encoding, preserving query and hash', () => {
    const { result } = pageResult()
    expect(useContentLocalePath(result)('en')).toBe('/guide/start')
    expect(router.resolve).toHaveBeenLastCalledWith({ path: '/guide/start', query: { q: 'a & b' }, hash: '#install' })
    route.hash = '#other'
    expect(useContentLocalePath(result)('de')).toBe('/de/einstieg')
    expect(router.resolve).toHaveBeenLastCalledWith({ path: '/de/einstieg', query: { q: 'a & b' }, hash: '#other' })
  })

  test('does not invent missing translations or consult application fallback for content', () => {
    const fallback = vi.fn(() => '/guessed')
    const { result } = pageResult()
    const path = useContentLocalePath(result, { fallback })
    expect(path('fr')).toBeUndefined()
    expect(path('unknown')).toBeUndefined()
    expect(fallback).not.toHaveBeenCalled()
  })

  test('prefers a real variant over a supplied fallback without constructing new alternates', () => {
    const { document, result } = pageResult()
    document.value!.route.alternates.unshift({ locale: 'en', path: '/fallback', source: 'fallback', resolvedLocale: 'de' })
    expect(useContentLocalePath(result)('en')).toBe('/guide/start')
    document.value!.route.alternates.push({ locale: 'fr', path: '/fr/einstieg', source: 'fallback', resolvedLocale: 'de' })
    expect(useContentLocalePath(result)('fr')).toBe('/fr/einstieg')
  })

  test.each(['pending', 'not-found', 'error'] as const)('suppresses links during %s and recovers with the same result', (state) => {
    const { status, result } = pageResult()
    const path = useContentLocalePath(result)
    status.value = state
    expect(path('en')).toBeUndefined()
    status.value = 'success'
    expect(path('en')).toBe('/guide/start')
  })

  test('rejects stale documents, including an old document that lists the new path as an alternate', () => {
    const { result } = pageResult()
    const path = useContentLocalePath(result)
    route.path = '/guide/start'
    expect(path('de')).toBeUndefined()
    route.path = '/de/einstieg/'
    expect(path('en')).toBe('/guide/start')
  })

  test('reacts to the owner source and calls fallback only for application-only pages', () => {
    const { result } = pageResult()
    const source = shallowRef<typeof result | undefined>(result)
    const fallback = vi.fn(() => '/application?keep=1#section')
    const path = useContentLocalePath(source, { fallback })
    const english = computed(() => path('en'))
    expect(english.value).toBe('/guide/start')
    source.value = undefined
    expect(english.value).toBe('/application?keep=1#section')
    expect(fallback).toHaveBeenCalledExactlyOnceWith('en')
    expect(path('unknown')).toBeUndefined()
    expect(useContentLocalePath(undefined)('en')).toBeUndefined()
  })

  test('uses collection-specific locale facts and suppresses a null document', () => {
    const { document, result } = pageResult()
    document.value!.route.alternates.push({ locale: 'it', path: '/it/inizio', source: 'variant' })
    const path = useContentLocalePath(result)
    expect(path('it')).toBe('/it/inizio')
    document.value = null
    expect(path('en')).toBeUndefined()
  })

  test('keeps independent owners isolated and propagates fallback failures', () => {
    const first = pageResult()
    const second = pageResult()
    second.status.value = 'error'
    expect(useContentLocalePath(first.result)('en')).toBe('/guide/start')
    expect(useContentLocalePath(second.result)('en')).toBeUndefined()
    const failure = new Error('application fallback failed')
    expect(() => useContentLocalePath(undefined, { fallback: () => { throw failure } })('en')).toThrow(failure)
  })
})
