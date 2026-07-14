import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export const resolveNuxtBuildArtifact = async (rootDir, relativePath, loadConfig) => {
  const config = await loadConfig({ cwd: rootDir })
  const buildDir = config.buildDir.startsWith('/')
    ? config.buildDir
    : resolve(rootDir, config.buildDir)

  return resolve(buildDir, relativePath)
}

export const readBenchmarkCorpus = async (source, createRecords) => {
  try {
    return {
      name: source.name,
      records: JSON.parse(await readFile(source.searchIndex, 'utf8')),
      artifact: source.searchIndex
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' || !source.snapshot) throw error
  }

  try {
    const snapshot = JSON.parse(await readFile(source.snapshot, 'utf8'))
    return {
      name: source.name,
      records: createRecords(snapshot),
      artifact: source.snapshot
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    throw new Error(
      `Search benchmark corpus for "${source.name}" is missing. Build the owning project first. Checked ${source.searchIndex} and ${source.snapshot}.`,
      { cause: error }
    )
  }
}

export const shapeBenchmarkResults = (results, recordsById, term, createExcerpt) => results.map((result) => {
  const record = recordsById.get(String(result.id))
  return {
    path: typeof result.path === 'string' ? result.path : '',
    collection: typeof result.collection === 'string' ? result.collection : '',
    title: typeof result.title === 'string' ? result.title : '',
    excerpt: createExcerpt(record?.content || '', term, typeof result.excerpt === 'string' ? result.excerpt : ''),
    score: typeof result.score === 'number' ? result.score : 0,
    anchor: typeof result.anchor === 'string' ? result.anchor : undefined,
    locale: typeof result.locale === 'string' ? result.locale : undefined
  }
})
