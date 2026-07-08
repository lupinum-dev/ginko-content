import { splitInlineLocaleVariantId } from './locale'
import type { ParsedContent } from '../../types/content'

export const CONTENT_SNAPSHOT_VERSION = 1 as const

export interface ContentSnapshot {
  version: typeof CONTENT_SNAPSHOT_VERSION
  /** Must equal the runtime config's cache integrity; mismatch means a stale artifact. */
  integrity: string
  generatedAt: number
  /** Fully-qualified, locale-suffixed ids. One per stored variant. */
  documentIds: string[]
  /** Source ids represented by the stored documents. Completeness is asserted on these. */
  documentSourceIds: string[]
  documents: ParsedContent[]
}

export interface BuildContentSnapshotArgs {
  integrity: string
  documents: ParsedContent[]
  sourceIds: string[]
  now: number
}

/** Build error carrying every offending path; never fail on just the first one. */
export class ContentSnapshotError extends Error {}

const documentIdOf = (document: ParsedContent) => document.id

const documentSourceIdOf = (document: ParsedContent) =>
  splitInlineLocaleVariantId(documentIdOf(document)).sourceId

const isPlainObject = (value: object) => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// `ancestors` holds only the objects on the current traversal path, not every
// visited object: a shared (non-circular) reference is valid JSON — stringify
// duplicates it — so only true cycles may be flagged.
const findNonJsonValue = (value: unknown, path: string, ancestors: WeakSet<object>): string | undefined => {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return undefined
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? undefined : path
  }

  if (typeof value !== 'object') {
    return path
  }

  if (ancestors.has(value)) {
    return path
  }
  ancestors.add(value)

  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) return `${path}[${index}]`
        const invalid = findNonJsonValue(value[index], `${path}[${index}]`, ancestors)
        if (invalid) return invalid
      }
      return undefined
    }

    if (!isPlainObject(value)) {
      return path
    }

    for (const [key, child] of Object.entries(value)) {
      const invalid = findNonJsonValue(child, `${path}.${key}`, ancestors)
      if (invalid) return invalid
    }
  } finally {
    ancestors.delete(value)
  }
}

export const buildContentSnapshot = (args: BuildContentSnapshotArgs): ContentSnapshot => {
  const lossy: string[] = []
  const documents: ParsedContent[] = []
  for (const document of args.documents) {
    // Skip the round-trip for flagged documents: JSON.stringify on a circular
    // structure throws a raw TypeError, which would preempt the aggregated
    // ContentSnapshotError below.
    if (findNonJsonValue(document, '$', new WeakSet())) {
      lossy.push(documentIdOf(document))
      continue
    }
    documents.push(JSON.parse(JSON.stringify(document)) as ParsedContent)
  }

  if (lossy.length > 0) {
    throw new ContentSnapshotError(
      `[content] snapshot: ${lossy.length} document(s) contain non-JSON values (Date, undefined, Map, ...): ${lossy.slice(0, 10).join(', ')}`
    )
  }

  return {
    version: CONTENT_SNAPSHOT_VERSION,
    integrity: args.integrity,
    generatedAt: args.now,
    documentIds: documents.map(documentIdOf),
    documentSourceIds: [...new Set(documents.map(documentSourceIdOf))].sort(),
    documents
  }
}

export const isContentSnapshot = (value: unknown): value is ContentSnapshot => {
  if (typeof value !== 'object' || value === null) return false
  const snapshot = value as Record<string, unknown>
  return snapshot.version === CONTENT_SNAPSHOT_VERSION
    && typeof snapshot.integrity === 'string'
    && typeof snapshot.generatedAt === 'number'
    && Array.isArray(snapshot.documentIds)
    && Array.isArray(snapshot.documentSourceIds)
    && Array.isArray(snapshot.documents)
}

export const assertSnapshotComplete = (snapshot: ContentSnapshot, sourceIds: string[]): void => {
  const have = new Set(snapshot.documentSourceIds)
  const missing = [...new Set(sourceIds)].filter(id => !have.has(id))
  if (missing.length > 0) {
    throw new ContentSnapshotError(
      `[content] snapshot incomplete: ${missing.length} source document(s) missing `
      + `(first ${Math.min(missing.length, 20)}): ${missing.slice(0, 20).join(', ')}. `
      + 'This build would silently 404 these pages in production.'
    )
  }
}
