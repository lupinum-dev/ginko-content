import type { ContentCollectionHandle } from '../../types/config'

export const ensureCollectionName = <H extends ContentCollectionHandle | string>(handle: H): string => {
  if (typeof handle === 'string') return handle
  if (!handle || typeof handle !== 'object' || typeof (handle as { name?: unknown }).name !== 'string') {
    throw new TypeError('query API: expected a string collection name or a collection handle from defineContentConfig({ collections }). Use useContentPage(\'docs\') or config.collections.docs.')
  }
  return (handle as { name: string }).name
}
