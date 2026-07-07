import type { H3Event } from 'h3'
import type { ParsedContent } from '../types/content'
import type { ContentGraph } from '../core/content/graph'
import { buildContentGraph } from '../core/content/graph'
import { isContentSnapshot } from '../core/content/snapshot'
import { cacheStorage, contentConfig } from './driver'

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
  const graph = buildContentGraph(raw.documents, {
    locales: config.locales,
    defaultLocale: config.defaultLocale
  })
  return {
    graph,
    documents: raw.documents
  }
}
