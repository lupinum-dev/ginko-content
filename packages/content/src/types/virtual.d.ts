declare module '#content/virtual/config' {
  import type { ContentConfig } from './config'

  const config: ContentConfig
  export default config
}

declare module '#content/virtual/providers' {
  import type { ContentProvider } from '../public/provider'

  export const externalContentProviderNames: string[]
  export const loadExternalContentProvider: (name: string) => Promise<ContentProvider | undefined> | ContentProvider | undefined
}

declare module '#content/virtual/transformers' {
  import type { ContentTransformer } from './content'

  export const transformers: ContentTransformer[]
}

declare module '#content/virtual/cache-adapter' {
  import type { ContentCacheAdapter } from '../public/provider'

  export const loadContentCacheAdapter: () => Promise<ContentCacheAdapter | undefined> | ContentCacheAdapter | undefined
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, any>
  export default component
}

declare module '#imports' {
  export type MaybeRefOrGetter<T = unknown> = import('vue').MaybeRefOrGetter<T>

  export const computed: typeof import('vue').computed
  export const nextTick: typeof import('vue').nextTick
  export const onScopeDispose: typeof import('vue').onScopeDispose
  export const ref: typeof import('vue').ref
  export const shallowRef: typeof import('vue').shallowRef
  export const toValue: typeof import('vue').toValue
  export const unref: typeof import('vue').unref
  export const watch: typeof import('vue').watch
  export const watchEffect: typeof import('vue').watchEffect

  export const defineNuxtPlugin: typeof import('#app').defineNuxtPlugin
  export const createError: typeof import('#app').createError
  export const refreshNuxtData: typeof import('#app').refreshNuxtData
  export const useAsyncData: typeof import('#app').useAsyncData
  export const useFetch: typeof import('#app').useFetch
  export const useHead: typeof import('#app').useHead
  export const useNuxtApp: typeof import('#app').useNuxtApp
  export const useCookie: typeof import('#app').useCookie
  export const useRequestEvent: typeof import('#app').useRequestEvent
  export const useRequestFetch: typeof import('#app').useRequestFetch
  export const useRoute: typeof import('#app').useRoute
  export const useRouter: typeof import('#app').useRouter
  export const useRuntimeConfig: typeof import('#app').useRuntimeConfig
  export const useState: typeof import('#app').useState
}

interface ImportMeta {
  readonly hot?: {
    on: (event: string, callback: (data: unknown) => void) => void
  }
}

declare module '#build/content-components' {
  import type { AsyncComponentLoader } from 'vue'

  export const globalComponents: string[]
  export const localComponents: string[]
  export const localComponentLoaders: Record<string, AsyncComponentLoader>
}

declare module 'js-yaml' {
  export const JSON_SCHEMA: unknown
  export function load(input: string, options?: Record<string, unknown>): unknown
  export function dump(input: unknown, options?: Record<string, unknown>): string
}
