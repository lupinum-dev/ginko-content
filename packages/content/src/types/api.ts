/**
 * Response envelope returned when a query resolves to a list.
 */
export interface ContentQueryFindResponse<T> {
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
 * Most application code should use the builder helpers (`.all()`, `.first()`,
 * `.count()`) instead of reading this union directly.
 */
export type ContentQueryResponse<T> = ContentQueryFindResponse<T> | ContentQueryFindOneResponse<T> | ContentQueryCountResponse

// Ensure that a .js file is emitted too
export {}
