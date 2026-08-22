export type ContentDataSourceErrorCode = 'QUERY_CURSOR_INVALID' | 'QUERY_UNSUPPORTED' | 'BACKEND_FAILURE'

class ContentDataSourceError extends Error {
  readonly code: ContentDataSourceErrorCode

  constructor(code: ContentDataSourceErrorCode) {
    super(code === 'QUERY_CURSOR_INVALID'
      ? 'Content data-source query cursor is invalid.'
      : code === 'QUERY_UNSUPPORTED'
        ? 'Content data-source query is unsupported.'
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
