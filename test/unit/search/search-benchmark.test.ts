import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readBenchmarkCorpus, resolveNuxtBuildArtifact, shapeBenchmarkResults } from '../../../benchmarks/search/support.mjs'

describe('search benchmark corpus', () => {
  it('resolves artifacts from Nuxt actual configured build directory', async () => {
    const root = '/project/docs'
    const artifact = await resolveNuxtBuildArtifact(root, 'content-cache/snapshot.json', async () => ({
      buildDir: '../generated/docs-nuxt'
    }))

    expect(artifact).toBe(resolve(root, '../generated/docs-nuxt/content-cache/snapshot.json'))
  })

  it('fails with an actionable error when neither generated corpus exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ginko-benchmark-'))

    await expect(readBenchmarkCorpus({
      name: 'docs',
      searchIndex: join(directory, 'missing-index.json'),
      snapshot: join(directory, 'missing-snapshot.json')
    }, () => [])).rejects.toThrow('Build the owning project first')
  })

  it('uses the generated search index before the snapshot fallback', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ginko-benchmark-'))
    const searchIndex = join(directory, 'index.json')
    await writeFile(searchIndex, '[{"id":"generated"}]')

    const corpus = await readBenchmarkCorpus({
      name: 'docs',
      searchIndex,
      snapshot: join(directory, 'missing-snapshot.json')
    }, () => [{ id: 'fallback' }])

    expect(corpus.records).toEqual([{ id: 'generated' }])
  })

  it('applies identical end-to-end shaping to engine-specific result objects', () => {
    const records = new Map([['record', { content: 'Canonical content match' }]])
    const excerpt = (content: string, term: string) => `${content}:${term}`
    const common = { id: 'record', path: '/docs', collection: 'docs', title: 'Docs', excerpt: '', score: 2, locale: 'en' }

    const mini = shapeBenchmarkResults([{ ...common, match: { title: ['docs'] }, queryTerms: ['docs'] }], records, 'docs', excerpt)
    const orama = shapeBenchmarkResults([{ ...common, content: 'engine copy', headings: ['Docs'] }], records, 'docs', excerpt)

    expect(mini).toEqual(orama)
    expect(Object.keys(mini[0] || {}).sort()).toEqual(['anchor', 'collection', 'excerpt', 'locale', 'path', 'score', 'title'])
  })
})
