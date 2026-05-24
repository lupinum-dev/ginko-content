import { listen } from 'listhen'
import type { WatchEvent } from 'unstorage'
import type { Nuxt } from '@nuxt/schema'

import { createWebSocket, MOUNT_PREFIX } from '../utils'
import { makeIgnored } from '../core/content/ignore'
import type { ContentContext, ModuleOptions } from '../types/module'

export const registerContentDevRuntime = (
  nuxt: Nuxt,
  options: ModuleOptions,
  contentContext: ContentContext
) => {
  const isIgnored = makeIgnored(contentContext.ignores)

  nuxt.hook('nitro:init', async (nitro) => {
    if (!options.watch || !options.watch.ws) {
      return
    }

    const ws = createWebSocket()
    const { server, url } = await listen(() => 'Ginko', options.watch.ws)
    const unwatch = await nitro.storage.watch(async (event: WatchEvent, key: string) => {
      if (!key.startsWith(MOUNT_PREFIX) || isIgnored(key)) {
        return
      }
      key = key.substring(MOUNT_PREFIX.length)

      await nitro.storage.removeItem('cache:content:_manifest.json')
      await nitro.storage.removeItem('cache:content:_nav.json')
      await nitro.storage.removeItem('cache:content:_meta.json')

      ws.broadcast({ event, key })
    })

    nitro.hooks.hook('close', async () => {
      await unwatch()
      await ws.close()
      await server.close()
    })

    server.on('upgrade', ws.serve)
    nitro.options.runtimeConfig.public.content.wsUrl = url.replace('http', 'ws')

    await nitro.storage.removeItem('cache:content:_manifest.json')
    await nitro.storage.removeItem('cache:content:_nav.json')
    await nitro.storage.removeItem('cache:content:_meta.json')
  })
}
