import { defineNuxtPlugin, refreshNuxtData } from '#imports'

type ContentHot = {
  on: (event: 'ginko-content:update', callback: (data: unknown) => void) => void
}

export function registerContentHotReload (
  hot: ContentHot | undefined,
  isClient: boolean,
  refresh: () => unknown
) {
  if (!hot || !isClient) {
    return
  }

  hot.on('ginko-content:update', (data) => {
    if (data && typeof data === 'object') {
      refresh()
    }
  })
}

export default defineNuxtPlugin(() => {
  registerContentHotReload(import.meta.hot, import.meta.client, refreshNuxtData)
})
