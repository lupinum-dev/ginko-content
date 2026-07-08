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

const describeSymbolKey = (symbol: symbol) =>
  `[${String(symbol)}] (symbol-keyed property)`

// `ancestors` holds only the objects on the current traversal path, not every
// visited object: a shared (non-circular) reference is valid JSON — stringify
// duplicates it — so only true cycles may be flagged.
const collectNonJsonValues = (value: unknown, path: string, ancestors: WeakSet<object>, offenders: string[]): void => {
  if (
    value === null
    || value === undefined
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    // `undefined` is admitted for the same prod-parity reason as Date:
    // JSON.stringify drops undefined-valued object keys (and nulls them in
    // arrays), which is exactly what the pre-snapshot production pipeline
    // served. Disabled-feature decorations (e.g. search: false) legitimately
    // set undefined fields on every document.
    return
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) offenders.push(path)
    return
  }

  if (typeof value !== 'object') {
    offenders.push(path)
    return
  }

  // Dates are admitted: JSON.stringify serializes them deterministically to
  // ISO strings, which matches what the pre-snapshot production pipeline
  // already served (parsed artifacts were stored as JSON), so round-tripping
  // is value-preserving with prior prod behavior. Frontmatter like
  // `date: 2026-01-01` parses to a Date and must not fail the build.
  // Invalid dates have no faithful serialization and stay rejected.
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) offenders.push(path)
    return
  }

  if (ancestors.has(value)) {
    offenders.push(path)
    return
  }
  ancestors.add(value)

  try {
    // Enumerable symbol-keyed properties are silently dropped by JSON.stringify
    // on both arrays and plain objects, so the rejection must run before either
    // container branch returns.
    for (const symbol of Object.getOwnPropertySymbols(value)) {
      if (Object.prototype.propertyIsEnumerable.call(value, symbol)) {
        offenders.push(`${path}${describeSymbolKey(symbol)}`)
      }
    }

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          offenders.push(`${path}[${index}]`)
          continue
        }
        collectNonJsonValues(value[index], `${path}[${index}]`, ancestors, offenders)
      }
      return
    }

    if (!isPlainObject(value)) {
      offenders.push(path)
      return
    }

    for (const [key, child] of Object.entries(value)) {
      collectNonJsonValues(child, `${path}.${key}`, ancestors, offenders)
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
    const offenders: string[] = []
    collectNonJsonValues(document, '$', new WeakSet(), offenders)
    if (offenders.length) {
      lossy.push(...offenders.map(path => `${documentIdOf(document)}:${path}`))
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
