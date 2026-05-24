import { existsSync } from 'fs'
import { join } from 'pathe'
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

  const importer = jiti(nuxt.options.rootDir, { interopDefault: true })
  const loaded = await importer.import(configPath) as any

  return loaded?.default || loaded || {}
}
