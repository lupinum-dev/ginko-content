import type { H3Event } from 'h3'
import { splitInlineLocaleVariantId } from '../../core/content/locale'
import {
  cacheParsedStorage,
  cacheStorage,
  contentConfig,
  contentIgnorePredicate,
  getContentsIds as getStorageContentsIds,
  getSourceContentIds,
  resolveStorageId,
  sourceStorage
} from '../../integrations/nitro/storage'
import { getProcessDocuments } from '../../storage/snapshot-runtime'

const isProduction = process.env.NODE_ENV === 'production'
const isPrerendering = import.meta.prerender

export const getContentsIds = async (event: H3Event, prefix?: string) => {
  if (!isProduction || isPrerendering) {
    return getStorageContentsIds(event, prefix)
  }

  const ids = new Set<string>()
  for (const document of await getProcessDocuments(event)) {
    const { sourceId } = splitInlineLocaleVariantId(document._id)
    if (!prefix || sourceId.startsWith(prefix)) {
      ids.add(sourceId)
    }
  }
  return [...ids]
}

export {
  cacheParsedStorage,
  cacheStorage,
  contentConfig,
  contentIgnorePredicate,
  getSourceContentIds,
  resolveStorageId,
  sourceStorage
}
