import type { H3Event } from 'h3'
import type { Storage } from 'unstorage'
import { sourceStorage, cacheStorage, cacheParsedStorage, contentConfig, contentIgnorePredicate, getContentsIds, getSourceContentIds, resolveStorageId } from '../integrations/nitro/storage'
import { getContentRuntimeContext } from '../integrations/nitro/context'

export interface ContentStorageRuntime {
  event: H3Event
  config: ReturnType<typeof contentConfig>
  source: Storage
  cache: Storage
  parsedCache: Storage
  now: () => Date
}

export const getContentStorageRuntime = (event: H3Event): ContentStorageRuntime => {
  const runtime = getContentRuntimeContext(event)
  return {
    event,
    config: runtime.config || contentConfig(),
    source: sourceStorage(event),
    cache: cacheStorage(event),
    parsedCache: cacheParsedStorage(event),
    now: runtime.now || (() => new Date())
  }
}

export {
  cacheParsedStorage,
  cacheStorage,
  contentConfig,
  contentIgnorePredicate,
  getContentsIds,
  getSourceContentIds,
  resolveStorageId,
  sourceStorage
}
