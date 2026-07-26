import type { H3Event } from 'h3'
import type { ParsedContent } from '../types/content'
import type { ContentGraph } from '../core/content/graph'
import { buildContentGraph } from '../core/content/graph'
import { isContentSnapshot } from '../core/content/snapshot'
import { assertFilesystemPreviewSupported, resolveRuntimeEnvironment } from '../core/visibility'
import { isPreview } from '../integrations/nitro/preview'
import { providerReferencePathAliases } from '../features/localization/reference-path'
import { cacheStorage, contentConfig } from './driver'

/**
 * Single source of truth for "serve from the process-scoped snapshot".
 * Prerender must stay on the request-scoped dev path — it is the phase that
 * produces the snapshot in the first place.
 */
export const usesProcessSnapshot = process.env.NODE_ENV === 'production' && !import.meta.prerender

interface ProcessSnapshotState {
  graph: ContentGraph
  documents: ParsedContent[]
}

let state: { integrity: string, promise: Promise<ProcessSnapshotState> } | null = null

export const getProcessGraph = async (event: H3Event): Promise<ContentGraph> => {
  const snapshotState = await getProcessSnapshotState(event)
  return snapshotState.graph
}

export const getProcessDocuments = async (event: H3Event): Promise<ParsedContent[]> => {
  const snapshotState = await getProcessSnapshotState(event)
  return snapshotState.documents
}

const getProcessSnapshotState = (event: H3Event): Promise<ProcessSnapshotState> => {
  // Defense-in-depth: `storage/graph.ts#getContentGraph`
  // is the primary choke point that asserts filesystem production-preview is
  // unsupported before reaching the process snapshot, but `storage/contents.ts`
  // (`getContentsList`/`getContent`) reads the process snapshot through
  // `getProcessDocuments` directly, bypassing that primary check. Asserting
  // here too — at the one place both `getProcessGraph` and
  // `getProcessDocuments` funnel through — closes that gap regardless of
  // which entry point a future caller uses.
  assertFilesystemPreviewSupported({
    environment: resolveRuntimeEnvironment(),
    previewAuthorized: isPreview(event)
  })

  const config = contentConfig()
  const integrity = config.cacheIntegrity
  if (state && state.integrity === integrity) {
    return state.promise
  }

  const promise = loadSnapshotState(event, integrity)
  promise.catch(() => {
    if (state?.promise === promise) {
      state = null
    }
  })
  state = { integrity, promise }
  return promise
}

const loadSnapshotState = async (event: H3Event, integrity: string): Promise<ProcessSnapshotState> => {
  const raw = await cacheStorage(event).getItem('snapshot.json')
  if (!isContentSnapshot(raw)) {
    throw new Error('[content] production snapshot missing or invalid — the site was built without a content snapshot. Rebuild with this package version.')
  }
  if (raw.integrity !== integrity) {
    throw new Error(`[content] snapshot integrity mismatch (built: ${raw.integrity}, runtime: ${integrity}) — stale build artifact.`)
  }

  const config = contentConfig()
  const localePolicies = config.localePolicy?.collections
  const graph = buildContentGraph(raw.documents, {
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    ...(localePolicies
      ? {
          referencePathAliases: (document: ParsedContent) =>
            providerReferencePathAliases(document, localePolicies)
        }
      : {})
  })
  return {
    graph,
    documents: raw.documents
  }
}
