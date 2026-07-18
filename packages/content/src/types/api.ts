/**
 * Response envelope returned when a query resolves to a list using offset
 * pagination — an exact `total`/`skip` page. `mode` is
 * optional here (rather than a required literal) so a plain, non-paginating
 * `many()` response — which carries no explicit pagination-mode contract —
 * remains a valid, unchanged instance of this shape.
 */
export interface ContentQueryOffsetFindResponse<T> {
  mode?: 'offset'
  /**
   * Matched documents after filtering, sorting, and projection.
   */
  result: Array<T>
  /**
   * Number of records skipped before the returned page.
   */
  skip: number
  /**
   * Requested page size.
   */
  limit: number
  /**
   * Total match count before paging is applied.
   */
  total: number
}

/**
 * Response envelope returned when a query resolves to a list using forward
 * cursor pagination. Deliberately has no `total`, `skip`, or `page` — a
 * bounded cursor-only provider cannot honestly produce those.
 */
export interface ContentQueryCursorFindResponse<T> {
  mode: 'cursor'
  result: Array<T>
  limit: number
  pageInfo: {
    endCursor: string | null
    hasNext: boolean
  }
}

/**
 * Response envelope returned when a query resolves to a list. Discriminated
 * by `mode` — see `ContentQueryOffsetFindResponse` / `ContentQueryCursorFindResponse`.
 */
export type ContentQueryFindResponse<T> = ContentQueryOffsetFindResponse<T> | ContentQueryCursorFindResponse<T>

/**
 * Response envelope returned when a query resolves to one document.
 */
export interface ContentQueryFindOneResponse<T> {
  /**
   * First matched document, or `undefined` when nothing matched.
   */
  result: T | undefined
}

/**
 * Response envelope returned when a query resolves to a count.
 */
export interface ContentQueryCountResponse {
  /**
   * Number of matched documents.
   */
  result: number
}

/**
 * Low-level transport response for the content query engine.
 *
 * Application code should use the unified `one()` / `many()` / `paginate()`
 * APIs instead of reading this union directly.
 */
export type ContentQueryResponse<T> = ContentQueryFindResponse<T> | ContentQueryFindOneResponse<T> | ContentQueryCountResponse

// Ensure that a .js file is emitted too
export {}
