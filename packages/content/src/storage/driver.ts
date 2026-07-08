import type { H3Event } from 'h3'
import type { Storage, StorageValue } from 'unstorage'
import { sourceStorage, cacheStorage, cacheParsedStorage, contentConfig, contentIgnorePredicate, getContentsIds, getSourceContentIds, resolveStorageId } from '../integrations/nitro/storage'
import { getContentRuntimeContext } from '../integrations/nitro/context'

export interface ContentSourceDriver {
  getKeys: (prefix?: string) => Promise<string[]>
  getItem: (key: string) => Promise<StorageValue | null>
  getMeta: (key: string) => Promise<{ mtime?: number, size?: number, [key: string]: unknown }>
}

export interface ContentCacheDriver {
  getItem: <T>(key: string) => Promise<T | null>
  setItem: (key: string, value: unknown) => Promise<void>
  removeItem?: (key: string) => Promise<void>
  getKeys?: (prefix?: string) => Promise<string[]>
}

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
