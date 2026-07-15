import { splitInlineLocaleVariantId } from './locale'
import type { ParsedContent } from '../../types/content'
import { collectJsonPurityViolations } from '../json-value'

// Bumped when the snapshot value model tightened from
// "JSON.stringify-representable" (which admitted `Date` and `undefined`) to
// strict JSON purity, matching the gate that already runs before graph
// insertion. A pre-0.3 snapshot on disk is not compatible with this reader.
export const CONTENT_SNAPSHOT_VERSION = 2 as const

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

/**
 * A cheap defensive re-assertion, not a normalization pass: by
 * the time a document reaches the snapshot builder it already passed the
 * canonical JSON-purity gate (`storage/validation.ts`'s
 * `validateDocumentJsonPurity`, run right after schema parsing and before
 * graph insertion). This just proves that invariant held — it must never
 * silently admit a different value model (no more Date/undefined leniency)
 * and never quietly re-normalize a value the gate should have already
 * rejected.
 */
export const buildContentSnapshot = (args: BuildContentSnapshotArgs): ContentSnapshot => {
  const lossy: string[] = []
  const documents: ParsedContent[] = []
  for (const document of args.documents) {
    // Skip the round-trip for flagged documents: JSON.stringify on a circular
    // structure throws a raw TypeError, which would preempt the aggregated
    // ContentSnapshotError below.
    const violations = collectJsonPurityViolations(document)
    if (violations.length) {
      lossy.push(...violations.map(violation => `${documentIdOf(document)}:${violation.path} (${violation.reason})`))
      continue
    }
    documents.push(JSON.parse(JSON.stringify(document)) as ParsedContent)
  }

  if (lossy.length > 0) {
    throw new ContentSnapshotError(
      `[content] snapshot: ${lossy.length} non-JSON value(s) found (invalid Date, Map, circular reference, symbol key, ...): ${lossy.slice(0, 10).join(', ')}`
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
