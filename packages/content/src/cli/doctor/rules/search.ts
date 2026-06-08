import { join } from 'node:path'
import type { DoctorFinding } from '../types'
import { readTextIfPresent } from '../files'
import { extractStringArrayProperty, findCollectionDefinitions, findObjectPropertyBlocks } from '../parsing'

export async function inspectSearchCollections(rootDir: string): Promise<DoctorFinding[]> {
  const contentConfig = await readTextIfPresent(join(rootDir, 'content.config.ts'))
  const nuxtConfig = await readTextIfPresent(join(rootDir, 'nuxt.config.ts'))

  if (!contentConfig || !nuxtConfig) {
    return []
  }

  const dataCollections = new Set(
    findCollectionDefinitions(contentConfig)
      .filter(collection => /\btype\s*:\s*['"]data['"]/.test(collection.block))
      .map(collection => collection.name)
  )

  if (!dataCollections.size) {
    return []
  }

  const configuredCollections = new Set(
    findObjectPropertyBlocks(nuxtConfig, 'search')
      .flatMap(block => extractStringArrayProperty(block, 'collections'))
  )
  const dataSearchCollections = [...configuredCollections].filter(collection => dataCollections.has(collection))

  if (!dataSearchCollections.length) {
    return []
  }

  return [{
    severity: 'info',
    file: 'nuxt.config.ts',
    message: `Data-only collections listed in content.search.collections: ${dataSearchCollections.join(', ')}.`,
    suggestion: 'Remove data-only collections from the static public search index, make them route-backed pages, or use provider-backed search with route-safe results.'
  }]
}
