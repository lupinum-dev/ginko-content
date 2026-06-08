import { createError } from 'h3'
import { statusForProviderError, type ContentProviderErrorCode } from '../core/provider-errors'

export type { ContentProviderErrorCode } from '../core/provider-errors'

export const createContentProviderError = (
  code: ContentProviderErrorCode,
  message: string,
  details: Record<string, unknown> = {}
) => createError({
  statusCode: statusForProviderError[code],
  statusMessage: code,
  message,
  data: {
    code,
    ...details
  }
})
