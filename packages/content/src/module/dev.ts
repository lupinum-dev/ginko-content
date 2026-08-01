import type { WatchEvent } from 'unstorage'
import type { Nuxt } from '@nuxt/schema'

import { MOUNT_PREFIX } from '../utils'
import { makeIgnored } from '../core/content/ignore'
import type { ContentContext, ModuleOptions } from '../types/module'

type ContentHotUpdate = {
  event: WatchEvent
  key: string
}

type ContentViteDevServer = {
  ws: {
    send: (payload: { type: 'custom', event: string, data: ContentHotUpdate }) => void
  }
}

export const registerContentDevRuntime = (
  nuxt: Nuxt,
  options: ModuleOptions,
  contentContext: ContentContext
) => {
  const isIgnored = makeIgnored(contentContext.ignores)
  let viteServer: ContentViteDevServer | undefined

  if (options.watch !== false) {
    nuxt.hook('vite:serverCreated', (server, environment) => {
      if (environment.isClient) {
        viteServer = server
      }
    })
  }

  ;(nuxt.hook as any)('nitro:init', async (nitro: any) => {
    if (options.watch === false) {
      return
    }

    const unwatch = await nitro.storage.watch(async (event: WatchEvent, key: string) => {
      if (!key.startsWith(MOUNT_PREFIX) || isIgnored(key)) {
        return
      }
      key = key.substring(MOUNT_PREFIX.length)

      // Each source owns one parsed-content cache entry. Derived graph,
      // navigation, and metadata views rebuild from those canonical inputs.
      await nitro.storage.removeItem(`cache:content:parsed:${key}`)

      const payload = { event, key } satisfies ContentHotUpdate
      viteServer?.ws.send({
        type: 'custom',
        event: 'ginko-content:update',
        data: payload
      })
    })

    nitro.hooks.hook('close', async () => {
      await unwatch()
    })
  })
}
