import { setHeader } from 'h3'
import {
  contentCacheHeaders,
  type ContentCacheAdapter
} from '#content/server'
import { adapterCacheEvents } from './cms-store'

export default {
  name: 'demo-cache',
  apply(event, hint) {
    const headers = contentCacheHeaders(hint)
    for (const [name, value] of headers) {
      setHeader(event, name, value)
    }
    if (hint.tags?.length) {
      setHeader(event, 'Cache-Tag', hint.tags.join(','))
    }
  },
  async invalidate(input) {
    adapterCacheEvents.push({ source: 'adapter', ...input })
  }
} satisfies ContentCacheAdapter
