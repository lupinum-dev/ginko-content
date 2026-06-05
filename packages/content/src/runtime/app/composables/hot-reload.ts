import { refreshNuxtData } from '#imports'

type ContentHot = {
  on: (event: 'ginko-content:update', callback: (data: unknown) => void) => void
}

let registered = false

const onContentUpdate = (data: unknown) => {
  if (!data || typeof data !== 'object') {
    return
  }

  refreshNuxtData()
}

export function registerContentHotReload (
  hot: ContentHot | undefined = import.meta.hot,
  isClient = import.meta.client
) {
  if (!hot || !isClient || registered) {
    return
  }

  registered = true
  hot.on('ginko-content:update', onContentUpdate)
}
