import { existsSync } from 'fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative } from 'pathe'
import jiti from 'jiti'
import type { Nuxt } from '@nuxt/schema'
import type { ContentConfig } from '../types/config'

const CONFIG_FILES = [
  'content.config.ts',
  'content.config.mts',
  'content.config.js',
  'content.config.mjs',
  'content.config.cjs'
]

const isLocalModule = (filename: string, rootDir: string) => {
  const localPath = relative(rootDir, filename)
  return Boolean(localPath)
    && !localPath.startsWith('../')
    && !isAbsolute(localPath)
    && !localPath.split('/').includes('node_modules')
}

const clearLocalNativeModules = (cache: NodeRequire['cache'], rootDir: string) => {
  for (const [id, entry] of Object.entries(cache)) {
    if (entry && isLocalModule(entry.filename, rootDir)) {
      Reflect.deleteProperty(cache, id)
    }
  }
}

export function resolveContentConfigPath (nuxt: Nuxt): string | undefined {
  return CONFIG_FILES
    .map(name => join(nuxt.options.rootDir, name))
    .find(path => existsSync(path))
}

export async function loadContentConfig (nuxt: Nuxt): Promise<ContentConfig> {
  const configPath = resolveContentConfigPath(nuxt)

  if (!configPath) {
    return {}
  }

  const nativeRequire = createRequire(configPath)
  clearLocalNativeModules(nativeRequire.cache, nuxt.options.rootDir)
  const importer = jiti(nuxt.options.rootDir, {
    interopDefault: true,
    // Nuxt reloads module setup in the same process for `options.watch`
    // changes. The authored config and its imports must not come from the
    // previous setup's module cache.
    moduleCache: false
  })
  // Content config is a synchronous declaration. Keeping its imports inside
  // Jiti's fresh graph avoids Node's process-wide ESM cache across soft reloads.
  let loaded: any
  try {
    loaded = importer(configPath) as any
  } finally {
    // Jiti can delegate CommonJS helpers to Node. Remove only local entries
    // introduced by this evaluation so the next setup reads them from disk.
    clearLocalNativeModules(nativeRequire.cache, nuxt.options.rootDir)
  }

  return loaded?.default || loaded || {}
}
