import { loadContentCacheAdapter } from '#content/virtual/cache-adapter'
import type { ContentCacheAdapter } from '../../public/provider'

export const getContentCacheAdapter = async (): Promise<ContentCacheAdapter | undefined> => {
  const adapter = await loadContentCacheAdapter()
  if (!adapter) {
    return undefined
  }

  if (
    typeof adapter.name !== 'string' ||
    typeof adapter.apply !== 'function' ||
    (adapter.invalidate !== undefined && typeof adapter.invalidate !== 'function')
  ) {
    throw new TypeError('Invalid content cache adapter. Expected { name, apply, invalidate? }.')
  }

  return adapter
}
