import type { Nuxt } from '@nuxt/schema'
import { createStorage, type WatchCallback } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { describe, expect, test, vi } from 'vitest'
import { registerContentDevRuntime } from '../../packages/content/src/module/dev'
import type { ContentContext, ModuleOptions } from '../../packages/content/src/types/module'

function watchedDriver() {
  let callback: WatchCallback | undefined
  const unwatch = vi.fn(async () => {})
  return {
    driver: {
      ...memoryDriver(),
      watch: vi.fn(async (handler: WatchCallback) => {
        callback = handler
        return unwatch
      }),
    },
    emit: async (key: string) => callback?.('update', key),
    unwatch,
  }
}

function setup(watch = true, ignores: string[] = []) {
  const hooks = new Map<string, (...args: never[]) => unknown>()
  const storage = createStorage()
  const root = watchedDriver()
  const content = watchedDriver()
  const remote = watchedDriver()
  const unrelated = watchedDriver()
  storage.mount('', root.driver)
  storage.mount('content:source:content', content.driver)
  storage.mount('content:source:remote', remote.driver)
  storage.mount('content:source-other', unrelated.driver)
  const closeHooks: (() => Promise<void>)[] = []
  const removeItem = vi.spyOn(storage, 'removeItem')
  const globalWatch = vi.spyOn(storage, 'watch')
  const nuxt = {
    hook: (name: string, handler: (...args: never[]) => unknown) => hooks.set(name, handler),
  }
  registerContentDevRuntime(nuxt as unknown as Nuxt, { watch } as ModuleOptions, { ignores } as ContentContext)
  const nitro = { storage, hooks: { hook: (_name: string, callback: () => Promise<void>) => closeHooks.push(callback) } }
  return {
    storage, root, content, remote, unrelated, removeItem, globalWatch,
    init: () => Reflect.apply(hooks.get('nitro:init')!, undefined, [nitro]),
    server: (send: ReturnType<typeof vi.fn>, isClient: boolean, isServer = !isClient) => {
      const hook = hooks.get('vite:serverCreated')
      if (hook) Reflect.apply(hook, undefined, [{ ws: { send } }, { isClient, isServer }])
    },
    close: async () => { for (const hook of closeHooks) await hook() },
    hooks,
  }
}

describe('content dev runtime', () => {
  test.each(['serial', 'environment-api'])('watches only sources and sends normalized changes to the client in %s mode', async (mode) => {
    const runtime = setup()
    const clientSend = vi.fn()
    const serverSend = vi.fn()
    runtime.server(clientSend, true, mode === 'environment-api')
    if (mode === 'serial') runtime.server(serverSend, false)
    await runtime.init()
    expect(runtime.globalWatch).not.toHaveBeenCalled()
    expect(runtime.root.driver.watch).not.toHaveBeenCalled()
    expect(runtime.unrelated.driver.watch).not.toHaveBeenCalled()
    expect(runtime.content.driver.watch).toHaveBeenCalledOnce()
    expect(runtime.remote.driver.watch).toHaveBeenCalledOnce()
    await runtime.content.emit('en/docs/intro.md')
    await runtime.remote.emit('guide.md')
    expect(runtime.removeItem.mock.calls.map(call => call[0])).toEqual([
      'cache:content:parsed:content:en:docs:intro.md',
      'cache:content:parsed:remote:guide.md',
    ])
    expect(clientSend).toHaveBeenCalledWith({ type: 'custom', event: 'ginko-content:update', data: { event: 'update', key: 'content:en:docs:intro.md' } })
    expect(serverSend).not.toHaveBeenCalled()
    await runtime.close()
    await runtime.close()
    expect(runtime.content.unwatch).toHaveBeenCalledOnce()
    expect(runtime.remote.unwatch).toHaveBeenCalledOnce()
  })

  test('ignores hidden and configured sources but reloads navigation', async () => {
    const runtime = setup(true, ['/drafts/'])
    await runtime.init()
    await runtime.content.emit('.hidden.md')
    await runtime.content.emit('drafts/post.md')
    expect(runtime.removeItem).not.toHaveBeenCalled()
    await runtime.content.emit('.navigation.yml')
    expect(runtime.removeItem).toHaveBeenCalledWith('cache:content:parsed:content:.navigation.yml')
    await runtime.close()
  })

  test('releases earlier subscriptions if a later source cannot watch', async () => {
    const runtime = setup()
    // Mounts are returned in storage's order; the longer name starts first.
    const first = runtime.storage.getMounts('content:source:')[0]!
    const last = runtime.storage.getMounts('content:source:').filter(mount => mount.base.startsWith('content:source:')).at(-1)!
    last.driver.watch = vi.fn(async () => { throw new Error('watch failed') })
    await expect(runtime.init()).rejects.toThrow('watch failed')
    const earlier = first.driver === runtime.content.driver ? runtime.content : runtime.remote
    expect(earlier.unwatch).toHaveBeenCalledOnce()
  })

  test('closes every source even if one cleanup rejects', async () => {
    const runtime = setup()
    runtime.content.unwatch.mockRejectedValueOnce(new Error('close failed'))
    await runtime.init()
    await expect(runtime.close()).rejects.toThrow('close failed')
    expect(runtime.content.unwatch).toHaveBeenCalledOnce()
    expect(runtime.remote.unwatch).toHaveBeenCalledOnce()
    await runtime.close()
  })

  test('does not start watchers or hot reload channels when disabled', async () => {
    const runtime = setup(false)
    await runtime.init()
    expect(runtime.hooks.has('vite:serverCreated')).toBe(false)
    expect(runtime.globalWatch).not.toHaveBeenCalled()
    expect(runtime.content.driver.watch).not.toHaveBeenCalled()
    await runtime.close()
  })
})
