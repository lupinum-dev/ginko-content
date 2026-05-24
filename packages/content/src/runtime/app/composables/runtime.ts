import { useRoute, useRuntimeConfig } from '#imports'

export function getContentRuntime() {
  return useRuntimeConfig().public.content
}

export function getContentRoute() {
  return useRoute()
}
