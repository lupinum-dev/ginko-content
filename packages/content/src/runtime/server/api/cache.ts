import { defineEventHandler } from 'h3'
import type { NavItem, ParsedContent } from '../../../types/content'
import { assertSnapshotComplete, buildContentSnapshot } from '../../../core/content/snapshot'
import { chunksFromArray, loadContentVariants } from '../../../storage/contents'
import { getContentProvider } from '../providers'
import { createContentProviderError } from '../../../public/provider-errors'
import { cacheStorage, contentConfig, getSourceContentIds } from '../storage-access'

const isRealDocument = (document: ParsedContent) => {
  return document.body !== null && typeof document._path === 'string' && document._path.length > 0
}

export default defineEventHandler(async (event) => {
  const now = Date.now()
  const config = contentConfig()
  const sourceIds = await getSourceContentIds(event)
  const documents: ParsedContent[] = []

  for (const chunk of chunksFromArray(sourceIds, 10)) {
    const results = await Promise.all(chunk.map(id => loadContentVariants(event, id)))
    documents.push(...results.flat().filter(isRealDocument))
  }

  const snapshot = buildContentSnapshot({
    integrity: config.cacheIntegrity,
    documents,
    sourceIds,
    now
  })
  assertSnapshotComplete(snapshot, sourceIds)
  await cacheStorage(event).setItem('snapshot.json', snapshot)

  const provider = await getContentProvider(event)
  if (!provider.navigationQuery) {
    throw createContentProviderError('unsupported_provider_operation', `${provider.name} does not support navigation queries`, {
      provider: provider.name
    })
  }
  const navigation: NavItem[] = await provider.navigationQuery(event, {})
  await cacheStorage(event).setItem('_nav.json', navigation)

  const meta = {
    generatedAt: now,
    documentCount: snapshot.documentIds.length,
    generateTime: Date.now() - now
  }
  await cacheStorage(event).setItem('_meta.json', meta)

  return {
    ...meta,
    navigation
  }
})
