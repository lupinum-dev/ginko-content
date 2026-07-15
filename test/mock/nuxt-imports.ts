type Ref<T> = { value: T }

const readGlobal = <T>(key: string, fallback: T): T => {
  const value = (globalThis as Record<string, unknown>)[key]
  return typeof value === 'undefined' ? fallback : value as T
}

export const computed = <T>(fn: () => T) => ({
  get value () {
    return fn()
  }
})

export const ref = <T>(value: T): Ref<T> => ({ value })
export const shallowRef = ref

export const toValue = <T>(value: T | Ref<T> | (() => T)): T => {
  if (typeof value === 'function') {
    return (value as () => T)()
  }
  if (value && typeof value === 'object' && 'value' in value) {
    return (value as Ref<T>).value
  }
  return value as T
}

export const useRuntimeConfig = () => readGlobal('__nuxtRuntimeConfig', { public: {} })
export const refreshNuxtData = () => readGlobal<() => void>('__nuxtRefreshNuxtData', () => {})()

export const useRequestFetch = () => async (url: unknown) => {
  const fetcher = readGlobal<((url: unknown) => unknown | Promise<unknown>) | undefined>('__nuxtUseFetch', undefined)
  if (!fetcher) {
    throw new Error('Missing __nuxtUseFetch test mock')
  }
  const result = await fetcher(url)
  if (result && typeof result === 'object' && 'data' in result) {
    return (result as { data: Ref<unknown> }).data.value
  }
  return result
}

export const useFetch = async (url: unknown) => {
  const fetcher = readGlobal<((url: unknown) => unknown | Promise<unknown>) | undefined>('__nuxtUseFetch', undefined)
  if (!fetcher) {
    return {
      data: ref(null),
      error: ref(new Error('Missing __nuxtUseFetch test mock')),
      pending: ref(false)
    }
  }
  return await fetcher(url)
}

export const useAsyncData = async (_key: unknown, handler: () => Promise<unknown>) => ({
  data: ref(await handler()),
  error: ref(null),
  pending: ref(false),
  status: ref('success')
})

export const watchEffect = (effect: (onCleanup: (cleanup: () => void) => void) => void | Promise<void>) => {
  let cleanup: (() => void) | undefined
  void effect((fn) => {
    cleanup = fn
  })
  return () => cleanup?.()
}
