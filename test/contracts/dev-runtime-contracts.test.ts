import type { Nuxt } from '@nuxt/schema'
import { createStorage, type Driver, type WatchCallback } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { registerContentDevRuntime } from '../../packages/content/src/module/dev'
import type { ContentContext, ModuleOptions } from '../../packages/content/src/types/module'

const factories = vi.hoisted(() => new Map<string, () => Driver>())
vi.mock('unstorage/drivers/fs', () => ({ default: (options: { base: string }) => factories.get(options.base)!() }))
beforeEach(() => factories.clear())

// Model unstorage's fs driver: one callback and one allocated watcher per
// driver instance; a second watch call returns the first subscription's stop.
function watchedSource(base: string) {
  const instances: ReturnType<typeof create>[] = []
  let failStartup = false
  let failCleanup = false
  function create() {
    let callback: WatchCallback | undefined
    let allocated = false
    const dispose = vi.fn(async () => { allocated = false; callback = undefined })
    const unwatch = vi.fn(async () => {
      if (failCleanup) throw new Error('close failed')
      allocated = false; callback = undefined
    })
    const driver = {
      ...memoryDriver(),
      dispose,
      watch: vi.fn(async (handler: WatchCallback) => {
        if (allocated) return unwatch
        allocated = true; callback = handler
        if (failStartup) throw new Error('watch failed')
        return unwatch
      }),
    }
    const instance = { driver, unwatch, dispose, allocated: () => allocated, emit: async (key: string) => callback?.('update', key) }
    instances.push(instance)
    return instance
  }
  factories.set(base, () => create().driver)
  return {
    create, instances,
    failStartup: () => { failStartup = true },
    failCleanup: () => { failCleanup = true },
    emit: async (key: string) => { for (const instance of instances) await instance.emit(key) },
  }
}

function setup(watch = true, ignores: string[] = []) {
  const hooks = new Map<string, (...args: never[]) => unknown>()
  const storage = createStorage()
  const root = watchedSource('root').create()
  const content = watchedSource('content')
  const remote = watchedSource('remote')
  const unrelated = watchedSource('unrelated').create()
  storage.mount('', root.driver)
  storage.mount('content:source:content', content.create().driver)
  storage.mount('content:source:remote', remote.create().driver)
  storage.mount('content:source-other', unrelated.driver)
  const closeHooks: (() => Promise<void>)[] = []
  const removeItem = vi.spyOn(storage, 'removeItem')
  const globalWatch = vi.spyOn(storage, 'watch')
  const nuxt = { hook: (name: string, handler: (...args: never[]) => unknown) => hooks.set(name, handler) }
  registerContentDevRuntime(nuxt as unknown as Nuxt, { watch } as ModuleOptions, { ignores } as ContentContext)
  const nitro = {
    storage,
    options: {
      storage: { 'content:source:content': { driver: 'fs', base: 'overridden' } },
      devStorage: { 'content:source:content': { driver: 'fs', base: 'content' }, 'content:source:remote': { driver: 'fs', base: 'remote' } },
    },
    hooks: { hook: (_name: string, callback: () => Promise<void>) => closeHooks.push(callback) },
  }
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
  test.each(['serial', 'environment-api'])('watches only owned sources and sends normalized changes in %s mode', async (mode) => {
    const runtime = setup()
    const clientSend = vi.fn(), serverSend = vi.fn()
    runtime.server(clientSend, true, mode === 'environment-api')
    if (mode === 'serial') runtime.server(serverSend, false)
    await runtime.init()
    expect(runtime.globalWatch).not.toHaveBeenCalled()
    expect(runtime.root.driver.watch).not.toHaveBeenCalled()
    expect(runtime.unrelated.driver.watch).not.toHaveBeenCalled()
    for (const source of [runtime.content, runtime.remote]) {
      expect(source.instances).toHaveLength(2)
      expect(source.instances[0]!.driver.watch).not.toHaveBeenCalled()
      expect(source.instances[1]!.driver.watch).toHaveBeenCalledOnce()
    }
    await runtime.content.emit('en/docs/intro.md')
    await runtime.remote.emit('guide.md')
    expect(runtime.removeItem.mock.calls.map(call => call[0])).toEqual(['cache:content:parsed:content:en:docs:intro.md', 'cache:content:parsed:remote:guide.md'])
    expect(clientSend).toHaveBeenCalledWith({ type: 'custom', event: 'ginko-content:update', data: { event: 'update', key: 'content:en:docs:intro.md' } })
    expect(serverSend).not.toHaveBeenCalled()
    await runtime.close(); await runtime.close()
    for (const source of [runtime.content, runtime.remote]) {
      expect(source.instances[0]!.dispose).not.toHaveBeenCalled()
      expect(source.instances[1]!.unwatch).toHaveBeenCalledOnce()
      expect(source.instances[1]!.allocated()).toBe(false)
    }
  })

  test.each(['before', 'after'])('does not steal or close another storage subscriber registered %s Content', async (order) => {
    const runtime = setup(), other = vi.fn(), client = vi.fn()
    runtime.server(client, true)
    let stop: (() => Promise<void>) | undefined
    if (order === 'before') stop = await runtime.storage.watch(other)
    await runtime.init()
    if (order === 'after') stop = await runtime.storage.watch(other)
    await runtime.content.emit('changed.md')
    expect(other).toHaveBeenCalledWith('update', 'content:source:content:changed.md')
    expect(client).toHaveBeenCalledWith(expect.objectContaining({ data: { event: 'update', key: 'content:changed.md' } }))
    await runtime.close()
    client.mockClear(); other.mockClear()
    await runtime.content.emit('after-close.md')
    expect(other).toHaveBeenCalledWith('update', 'content:source:content:after-close.md')
    expect(client).not.toHaveBeenCalled()
    await stop?.(); await runtime.storage.dispose()
  })

  test('ignores hidden and configured sources but reloads navigation', async () => {
    const runtime = setup(true, ['/drafts/'])
    await runtime.init()
    await runtime.content.emit('.hidden.md'); await runtime.content.emit('drafts/post.md')
    expect(runtime.removeItem).not.toHaveBeenCalled()
    await runtime.content.emit('.navigation.yml')
    expect(runtime.removeItem).toHaveBeenCalledWith('cache:content:parsed:content:.navigation.yml')
    await runtime.close()
  })

  test('disposes an allocated-then-failed startup and earlier owned subscriptions', async () => {
    const runtime = setup()
    runtime.remote.failStartup()
    await expect(runtime.init()).rejects.toThrow('watch failed')
    for (const source of [runtime.content, runtime.remote]) {
      expect(source.instances[0]!.dispose).not.toHaveBeenCalled()
      expect(source.instances[1]!.dispose).toHaveBeenCalledOnce()
      expect(source.instances[1]!.allocated()).toBe(false)
    }
  })

  test('disposes every owned source even if an unwatch fails', async () => {
    const runtime = setup()
    await runtime.init(); runtime.content.failCleanup()
    await expect(runtime.close()).rejects.toThrow('close failed')
    for (const source of [runtime.content, runtime.remote]) expect(source.instances[1]!.allocated()).toBe(false)
    await runtime.close()
  })

  test('does not create watchers or hot reload channels when disabled', async () => {
    const runtime = setup(false)
    await runtime.init()
    expect(runtime.hooks.has('vite:serverCreated')).toBe(false)
    expect(runtime.globalWatch).not.toHaveBeenCalled()
    expect(runtime.content.instances).toHaveLength(1)
    await runtime.close()
  })
})
