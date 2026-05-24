import type { IncomingMessage } from 'http'
import { resolve } from 'pathe'
import type { Nuxt } from '@nuxt/schema'
import fsDriver from 'unstorage/drivers/fs'
import httpDriver from 'unstorage/drivers/http'
import githubDriver from 'unstorage/drivers/github'
import { WebSocketServer } from 'ws'
import { consola } from 'consola'

import type { ModuleOptions, MountOptions } from './types'
import type { ResolvedMarkdownPlugin } from './types/content'

export const logger = consola.withTag('@lupinum/ginko-content')

/**
 * Internal version that represents cache format.
 * This is used to invalidate cache when the format changes.
 */
export const CACHE_VERSION = 3

export const MOUNT_PREFIX = 'content:source:'

const unstorageDrivers = {
  fs: fsDriver,
  http: httpDriver,
  github: githubDriver
}

/**
 * Resolve driver of a mount.
 */
export async function getMountDriver (mount: MountOptions) {
  const dirverName = mount.driver as keyof typeof unstorageDrivers
  if (unstorageDrivers[dirverName]) {
    return unstorageDrivers[dirverName](mount as Record<string, unknown>)
  }

  const driver = (await import(mount.driver)).default
  return driver(mount as Record<string, unknown>)
}

/**
 * Generate mounts for content storages
 */
export function useContentMounts (nuxt: Nuxt, storages: Record<string, MountOptions>) {
  const key = (path: string, prefix = '') => `${MOUNT_PREFIX}${path.replace(/[/:]/g, '_')}${prefix.replace(/\//g, ':')}`
  const baseDir = (nuxt.options.future as unknown as { compatibilityVersion: number })?.compatibilityVersion === 4
    ? nuxt.options.rootDir
    : nuxt.options.srcDir
  storages = Object.entries(storages).reduce((mounts, [name, storage]) => {
    mounts[key(storage.name || name, storage.prefix)] = storage
    return mounts
  }, {} as Record<string, MountOptions>)

  const defaultStorage = key('content')
  if (!storages[defaultStorage]) {
    storages[defaultStorage] = {
      name: defaultStorage,
      driver: 'fs',
      base: resolve(baseDir, 'content')
    }
  }

  return storages
}
/**
 * WebSocket server useful for live content reload.
 */
export function createWebSocket () {
  const wss = new WebSocketServer({ noServer: true })

  const serve = (req: IncomingMessage, socket = req.socket, head: any = '') =>
    wss.handleUpgrade(req, socket, head, (client: any) => wss.emit('connection', client, req))

  const broadcast = (data: any) => {
    data = JSON.stringify(data)

    for (const client of wss.clients) {
      try {
        client.send(data)
      } catch {
        logger.debug('Skipping websocket client that is not ready to receive content refresh events.')
      }
    }
  }

  return {
    serve,
    broadcast,
    close: () => {
      // disconnect all clients
      wss.clients.forEach(client => client.close())
      // close the server
      return new Promise(resolve => wss.close(resolve))
    }
  }
}

export function processMarkdownOptions (options: ModuleOptions['markdown']) {
  // Refine anchor link generation
  const anchorLinks = typeof options.anchorLinks === 'boolean'
    ? { depth: options.anchorLinks ? 6 : 0, exclude: [] }
    : { depth: 4, exclude: [1], ...options.anchorLinks }
  const plugins = options.plugins?.length
    ? options.plugins
    : [
        ['toc', { depth: 2, searchDepth: 2 }],
        'summary'
      ] satisfies ModuleOptions['markdown']['plugins']

  return {
    ...options,
    anchorLinks,
    plugins: resolveMarkdownPlugins(plugins)
  }
}

function resolveMarkdownPlugins (plugins: ModuleOptions['markdown']['plugins']): ResolvedMarkdownPlugin[] {
  return (plugins || []).map((plugin) => {
    const [name, options] = Array.isArray(plugin) ? plugin : [plugin, {}]
    return {
      name,
      options
    }
  })
}
