/**
 * Typed error envelope for the content pipeline.
 *
 * Every expected-failure path in `core/`, `storage/`, and `integrations/` emits
 * a `ContentError` with one of the codes below. Boundary code (HTTP handler,
 * CLI) maps codes to user-facing responses; tests pattern-match on `.code`.
 */
export type ContentErrorCode =
  // Ingest-stage failures. Specific typed validation errors from
  // `validateCollectionDocument` are preserved instead of being wrapped.
  | 'PARSE_FAILED'
  | 'TRANSFORM_FAILED'
  | 'VALIDATION_FAILED'
  // Generic ingest-level wrapper for failures that cross parser/transformer
  // boundaries without a more specific user-actionable code.
  | 'INVALID_CONTENT'
  // Graph-level invariant violations detected by `storage/validation`.
  // Two documents resolve to the same canonical key/path/ref — user must pick one.
  | 'DUPLICATE_CANONICAL_ID'
  | 'DUPLICATE_LOCALIZED_PATH'
  // Explicit `id`/`ref` fields disagree between locale variants of the same
  // document, or the same `ref` is claimed by unrelated documents.
  | 'CONFLICTING_REFS'
  | 'INVALID_REF_VALUE'
  // Structured frontmatter/YAML that failed shape validation before Zod runs.
  | 'INVALID_NAVIGATION_YAML'
  // A collection's Zod schema rejected the document (strict collection only;
  // non-strict collections warn and pass through).
  | 'SCHEMA_VALIDATION_FAILED'
  // Post-schema document contains a value outside the canonical JSON value
  // model (Date, Map, Set, undefined, bigint, class instance, cycle, array
  // hole, symbol, non-finite number, ...). Runs after schema parsing and
  // before graph insertion, in both dev and build.
  | 'NON_JSON_VALUE'
  // One file matched multiple collection globs — the resolver cannot decide
  // which collection owns the document.
  | 'CONFLICTING_COLLECTION_MATCH'
  // Translated-slugs mode found two localized siblings claiming the same
  // numeric prefix.
  | 'TRANSLATED_SLUG_CONFLICT'

export class ContentError extends Error {
  readonly code: ContentErrorCode
  readonly context: Record<string, unknown>

  constructor(
    code: ContentErrorCode,
    message: string,
    context: Record<string, unknown> = {},
    options?: { cause?: unknown }
  ) {
    super(message)
    if (options?.cause !== undefined) {
      ;(this as Error & { cause?: unknown }).cause = options.cause
    }
    this.name = 'ContentError'
    this.code = code
    this.context = context
  }
}
