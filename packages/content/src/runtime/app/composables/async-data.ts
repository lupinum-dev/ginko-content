import { useAsyncData } from '#imports'

// Thin indirection so contract tests can replace Nuxt's async-data binding
// without needing a full Nuxt app instance.
export function useContentAsyncData<T>(...args: Parameters<typeof useAsyncData<T>>) {
  return useAsyncData<T>(...args)
}
