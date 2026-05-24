import type { H3Event } from 'h3'
import type { ContentCacheHint, ContentCacheHintInput } from '../../public/provider'
import { mergeContentCacheHints } from '../../core/cache-hints'
import { getContentRuntimeContext } from '../../integrations/nitro/context'
import { isPreview } from '../../integrations/nitro/preview'

export const collectContentCacheHint = (event: H3Event, hint: ContentCacheHintInput | undefined) => {
  if (typeof hint === 'undefined') {
    return
  }

  const runtime = getContentRuntimeContext(event)
  runtime.cacheHint = isPreview(event)
    ? false
    : mergeContentCacheHints(runtime.cacheHint, hint)
}

export const getContentCacheHint = (event: H3Event): ContentCacheHint | false | undefined => {
  const runtime = getContentRuntimeContext(event)
  return isPreview(event) ? false : runtime.cacheHint
}

export const clearContentCacheHint = (event: H3Event) => {
  getContentRuntimeContext(event).cacheHint = undefined
}
