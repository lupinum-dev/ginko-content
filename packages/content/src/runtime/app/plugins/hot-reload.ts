import { defineNuxtPlugin } from '#imports'

export default defineNuxtPlugin(() => {
  if (import.meta.client && import.meta.hot) {
    import('../composables/hot-reload').then(({ registerContentHotReload }) => registerContentHotReload())
  }
})
