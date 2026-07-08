import { defineEventHandler } from 'h3'
import type { NavItem, ParsedContent } from '../../../types/content'
import { assertSnapshotComplete, buildContentSnapshot } from '../../../core/content/snapshot'
import { chunksFromArray, loadContentVariants } from '../../../storage/contents'
import { getContentProvider } from '../providers'
import { createContentProviderError } from '../../../public/provider-errors'
import { cacheStorage, contentConfig, getSourceContentIds } from '../storage-access'

const isRealDocument = (document: ParsedContent) => {
  return document.body !== null && typeof document.path === 'string' && document.path.length > 0
}

/**
 * A source id that produced no snapshot document failed one of two ways;
 * naming which one turns a confusing build failure into an actionable one.
 */
const describeExcludedSource = (variants: ParsedContent[]) => {
  if (variants.length === 0 || variants.every(variant => variant.body === null)) {
    return 'unreadable (source missing or failed to parse)'
  }
  return 'no route path (parsed, but every variant lacks a path)'
}

export default defineEventHandler(async (event) => {
  const now = Date.now()
  const config = contentConfig()
  const sourceIds = await getSourceContentIds(event)
  const documents: ParsedContent[] = []
  const excluded = new Map<string, string>()

  for (const chunk of chunksFromArray(sourceIds, 10)) {
    const results = await Promise.all(chunk.map(async (id) => [id, await loadContentVariants(event, id)] as const))
    for (const [id, variants] of results) {
      const real = variants.filter(isRealDocument)
      if (real.length === 0) {
        excluded.set(id, describeExcludedSource(variants))
      }
      documents.push(...real)
    }
  }

  if (excluded.size > 0) {
    const details = [...excluded.entries()]
      .slice(0, 20)
      .map(([id, reason]) => `${id}: ${reason}`)
      .join('; ')
    throw new Error(
      `[content] snapshot build failed: ${excluded.size} source document(s) produced no servable content `
      + `and would silently 404 in production. First ${Math.min(excluded.size, 20)} — ${details}`
    )
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
