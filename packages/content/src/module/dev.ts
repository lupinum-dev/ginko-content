import type { WatchEvent } from 'unstorage'
import type { Nuxt } from '@nuxt/schema'
import type { ViteDevServer } from 'vite'

import { MOUNT_PREFIX } from '../utils'
import { makeIgnored } from '../core/content/ignore'
import type { ContentContext, ModuleOptions } from '../types/module'

type ContentHotUpdate = {
  event: WatchEvent
  key: string
}

export const registerContentDevRuntime = (
  nuxt: Nuxt,
  options: ModuleOptions,
  contentContext: ContentContext
) => {
  const isIgnored = makeIgnored(contentContext.ignores)
  let viteServer: ViteDevServer | undefined

  if (options.watch !== false) {
    nuxt.options.vite ||= {}
    nuxt.options.vite.plugins ||= []
    ;(nuxt.options.vite.plugins as any[]).push({
      name: 'ginko-content-hmr',
      configureServer(server: ViteDevServer) {
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

      // `_manifest.json`/`_nav.json`/`_meta.json` are deleted derivatives
      // (VNEXT.md §15.7, §25.4) — dev never persists them, so there is
      // nothing to invalidate here anymore. The per-source parsed-content
      // cache entry is the only dev artifact this watcher still owns.
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
