import { resolve } from 'pathe'
import type { Nuxt } from '@nuxt/schema'

import type { ModuleOptions, MountOptions } from './types'
import type { MarkdownOptions, ResolvedMarkdownPlugin } from './types/content'

/**
 * Internal version that represents cache format.
 * This is used to invalidate cache when the format changes.
 */
export const CACHE_VERSION = 3

export const MOUNT_PREFIX = 'content:source:'

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
export function processMarkdownOptions (options: ModuleOptions['markdown']): MarkdownOptions {
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
    anchorLinks,
    tags: options.tags || {},
    image: options.image,
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
