import { createError } from 'h3'
import { statusForProviderError, type ContentProviderErrorCode } from '../core/provider-errors'

export type { ContentProviderErrorCode } from '../core/provider-errors'

export const createContentProviderError = (
  code: ContentProviderErrorCode,
  message: string,
  details: Record<string, unknown> = {},
  cause?: unknown
) => {
  const error = createError({
    statusCode: statusForProviderError[code],
    statusMessage: code,
    message,
    data: {
      code,
      ...details
    }
  })

  // H3 makes its synthetic `cause` enumerable. Replace it with the real
  // internal cause (when one exists) without allowing object spreads or JSON
  // serializers to turn implementation details into a public error payload.
  Object.defineProperty(error, 'cause', {
    value: cause,
    configurable: true,
    writable: true,
    enumerable: false
  })

  return error
}
