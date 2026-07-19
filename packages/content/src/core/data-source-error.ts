export type ContentDataSourceErrorCode = 'QUERY_CURSOR_INVALID' | 'BACKEND_FAILURE'

class ContentDataSourceError extends Error {
  readonly code: ContentDataSourceErrorCode

  constructor(code: ContentDataSourceErrorCode) {
    super(code === 'QUERY_CURSOR_INVALID'
      ? 'Content data-source query cursor is invalid.'
      : 'Content data-source operation failed.')
    this.name = 'ContentDataSourceError'
    this.code = code
  }
}

export const createContentDataSourceError = (code: ContentDataSourceErrorCode): Error =>
  new ContentDataSourceError(code)

export const isContentDataSourceError = (
  value: unknown
): value is Error & { code: ContentDataSourceErrorCode } => value instanceof ContentDataSourceError
