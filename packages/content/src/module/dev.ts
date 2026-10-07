import { builtinDrivers, normalizeKey, type Driver, type Unwatch, type WatchEvent } from 'unstorage'
import type { Nuxt } from '@nuxt/schema'
import type { Nitro } from 'nitropack'

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

  // Nuxt 4.5 moves Nitro hook types into its optional server builder. Content
  // still requires Nitro; keep this compatibility boundary typed without
  // making consumers install that builder directly.
  const hookNitroInit = nuxt.hook as (
    name: 'nitro:init', callback: (nitro: Nitro) => Promise<void>
  ) => void
  hookNitroInit('nitro:init', async (nitro) => {
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

    const ownedSources: { driver: Driver, unwatch?: Unwatch }[] = []
    const close = async () => {
      const results = await Promise.allSettled(ownedSources.splice(0).map(async (source) => {
        // A driver's watch can allocate a resource before rejecting, or its
        // returned unwatch can reject. Always dispose our instance as well.
        try { await source.unwatch?.() }
        finally { await source.driver.dispose?.() }
      }))
      const failure = results.find(result => result.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
    }
    try {
      // Nitro's mounted drivers can already belong to other storage subscribers.
      // Instantiate only our watchable source mounts, using the same resolved
      // driver options as Nitro. Never subscribe to or close its shared drivers.
      const mounts = { ...nitro.options.storage, ...nitro.options.devStorage }
      for (const [base, sourceOptions] of Object.entries(mounts)) {
        const mountBase = `${normalizeKey(base)}:`
        if (!mountBase.startsWith(MOUNT_PREFIX) || !sourceOptions.driver) continue
        if (!nitro.storage.getMount(base).driver.watch) continue
        const specifier = Object.entries(builtinDrivers).find(([name]) => name === sourceOptions.driver)?.[1] ?? sourceOptions.driver
        const module = await import(specifier)
        // Nitro validates this external driver-factory contract when mounting it.
        const createDriver = (module.default || module) as (options: typeof sourceOptions) => Driver
        const source: { driver: Driver, unwatch?: Unwatch } = { driver: createDriver(sourceOptions) }
        ownedSources.push(source)
        source.unwatch = await source.driver.watch?.((event, key) => onChange(event, normalizeKey(`${mountBase}${key}`)))
      }
    } catch (error) {
      await close()
      throw error
    }
    nitro.hooks.hook('close', close)
  })
}
