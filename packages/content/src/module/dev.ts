import { normalizeKey, type Unwatch, type WatchEvent } from 'unstorage'
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

  nuxt.hook('nitro:init', async (nitro) => {
    if (options.watch === false) {
      return
    }

    const onChange = async (event: WatchEvent, key: string) => {
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
    }

    const subscriptions: Unwatch[] = []
    const close = async () => {
      const results = await Promise.allSettled(subscriptions.splice(0).map(async unwatch => unwatch()))
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    }
    try {
      // A global storage subscription starts watchers for Nitro's root, build,
      // cache and dependency trees before filtering keys. Content owns only
      // its source mounts, including providers outside the application root.
      for (const mount of nitro.storage.getMounts(MOUNT_PREFIX)) {
        if (!mount.base.startsWith(MOUNT_PREFIX) || !mount.driver.watch) continue
        subscriptions.push(await mount.driver.watch((event, key) => onChange(event, normalizeKey(`${mount.base}${key}`))))
      }
    } catch (error) {
      await close()
      throw error
    }
    nitro.hooks.hook('close', close)
  })
}
