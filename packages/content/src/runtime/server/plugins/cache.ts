import { defineNitroPlugin } from 'nitropack/runtime'
import { clearContentCacheHint, getContentCacheHint } from '../cache-hints'
import { getContentCacheAdapter } from '../cache-adapter'

export default defineNitroPlugin((nitro) => {
  nitro.hooks.hook('render:response', async (_response, { event }) => {
    const hint = getContentCacheHint(event)
    if (!hint) {
      clearContentCacheHint(event)
      return
    }

    const adapter = await getContentCacheAdapter()
    if (adapter) {
      await adapter.apply(event, hint)
    }
    clearContentCacheHint(event)
  })
})
