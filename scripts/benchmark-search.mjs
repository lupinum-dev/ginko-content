import { build as bundle } from 'esbuild'
import { gzipSync } from 'node:zlib'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { resolve } from 'node:path'
import process from 'node:process'
import MiniSearch from 'minisearch'
import { create, insertMultiple, load, save, search } from '@orama/orama'
import { loadNuxtConfig } from '@nuxt/kit'
import { createSearchSections } from '../packages/content/dist/features/search/sections.js'
import { toSearchIndexRecord } from '../packages/content/dist/features/search/records.js'
import { createSearchExcerpt } from '../packages/content/dist/features/search/snippet.js'
import { readBenchmarkCorpus, resolveNuxtBuildArtifact } from './lib/search-benchmark.mjs'

const root = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(root, '.benchmarks/search')
const docsRoot = resolve(root, 'docs')
const docsSnapshot = await resolveNuxtBuildArtifact(
  docsRoot,
  'content-cache/snapshot.json',
  loadNuxtConfig
)
const corpusSources = [
  {
    name: 'docs',
    searchIndex: resolve(root, 'docs/.output/public/api/_content/search/index.json'),
    snapshot: docsSnapshot
  },
  {
    name: 'i18n',
    searchIndex: resolve(root, 'playground/ginko-i18n/.output/public/api/_content/search/index.json')
  }
]
const goldenQueriesPath = resolve(root, 'benchmarks/search/golden-queries.json')
const queryIterations = 200
const timingIterations = 9

const miniSearchOptions = {
  fields: ['title', 'content', 'headings'],
  storeFields: ['path', 'title', 'excerpt', 'anchor', 'locale', 'collection'],
  searchOptions: {
    boost: { title: 4, headings: 2, content: 1 },
    fuzzy: 0.2,
    prefix: true
  }
}

const oramaSchema = {
  title: 'string',
  content: 'string',
  headings: 'string[]',
  path: 'string',
  excerpt: 'string',
  anchor: 'string',
  locale: 'enum',
  collection: 'enum'
}

const bytes = value => Buffer.byteLength(value)
const percentile = (values, quantile) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] || 0
}
const median = values => percentile(values, 0.5)
const round = value => Math.round(value * 1000) / 1000
const collectGarbage = () => globalThis.gc?.()

const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

const loadCorpus = async source => readBenchmarkCorpus(source, (snapshot) => {
  const pages = snapshot.documents.filter(document => document.type === 'markdown' && document.partial !== true)
  const sections = createSearchSections(pages, {
    ignoredTags: ['script', 'style', 'pre'],
    extraFields: ['locale', 'collection']
  })
  return sections.map(toSearchIndexRecord)
})

const normalizeRecords = corpora => corpora.flatMap(({ name, records }) => records.map((record, index) => ({
  ...record,
  id: `${name}:${record.id || index}`,
  path: typeof record.path === 'string' ? record.path : '',
  title: typeof record.title === 'string' ? record.title : '',
  excerpt: typeof record.excerpt === 'string' ? record.excerpt : '',
  content: typeof record.content === 'string' ? record.content : '',
  headings: Array.isArray(record.headings) ? record.headings.filter(value => typeof value === 'string') : [],
  anchor: typeof record.anchor === 'string' ? record.anchor : '',
  locale: typeof record.locale === 'string' ? record.locale : 'en',
  collection: typeof record.collection === 'string' && record.collection ? record.collection : 'docs'
})))

const miniSearchAdapter = {
  name: 'MiniSearch',
  create(records) {
    const index = new MiniSearch(miniSearchOptions)
    index.addAll(records)
    return index
  },
  search(index, term, locale) {
    return index.search(term, locale ? { filter: result => result.locale === locale } : undefined).slice(0, 10).map(result => result)
  },
  serialize(index) {
    return JSON.stringify(index)
  },
  restore(serialized) {
    return MiniSearch.loadJSON(serialized, miniSearchOptions)
  },
  bundleEntry: "import MiniSearch from 'minisearch'; export { MiniSearch }"
}

const oramaAdapter = {
  name: 'Orama',
  create(records) {
    const database = create({ schema: oramaSchema })
    insertMultiple(database, records)
    return database
  },
  search(database, term, locale) {
    return search(database, {
      term,
      limit: 10,
      ...(locale ? { where: { locale: { eq: locale } } } : {}),
      boost: { title: 4, headings: 2, content: 1 }
    }).hits.map(hit => ({ ...hit.document, score: hit.score }))
  },
  serialize(database) {
    return JSON.stringify(save(database))
  },
  restore(serialized) {
    const database = create({ schema: oramaSchema })
    load(database, JSON.parse(serialized))
    return database
  },
  bundleEntry: "export { create, insertMultiple, load, save, search } from '@orama/orama'"
}

const measureBundle = async adapter => {
  const result = await bundle({
    stdin: { contents: adapter.bundleEntry, resolveDir: root },
    bundle: true,
    format: 'esm',
    minify: true,
    platform: 'browser',
    treeShaking: true,
    write: false
  })
  const code = result.outputFiles[0].contents
  return { rawBytes: code.byteLength, gzipBytes: gzipSync(code).byteLength }
}

const measureEngine = async (adapter, records, queries) => {
  const buildTimes = []
  for (let iteration = 0; iteration < timingIterations; iteration++) {
    collectGarbage()
    const started = performance.now()
    adapter.create(records)
    buildTimes.push(performance.now() - started)
  }

  collectGarbage()
  const heapBefore = process.memoryUsage().heapUsed
  const fullIndex = adapter.create(records)
  const recordsById = new Map(records.map(record => [record.id, record]))
  collectGarbage()
  const heapAfter = process.memoryUsage().heapUsed
  const serialized = adapter.serialize(fullIndex)

  const restoreTimes = []
  for (let iteration = 0; iteration < timingIterations; iteration++) {
    collectGarbage()
    const started = performance.now()
    adapter.restore(serialized)
    restoreTimes.push(performance.now() - started)
  }

  const shape = (results, term) => results.map(result => ({
    ...result,
    excerpt: createSearchExcerpt(recordsById.get(String(result.id))?.content || result.content || '', term, result.excerpt || '')
  }))

  const relevance = queries.map(query => {
    const results = adapter.search(fullIndex, query.term, query.locale)
    const paths = results.map(result => result.path)
    return {
      ...query,
      top1: query.expectedPaths.includes(paths[0]),
      top3: paths.slice(0, 3).some(path => query.expectedPaths.includes(path)),
      actualTop3: paths.slice(0, 3)
    }
  })

  for (const query of queries) {
    adapter.search(fullIndex, query.term, query.locale)
  }
  const queryTimes = []
  for (let iteration = 0; iteration < queryIterations; iteration++) {
    for (const query of queries) {
      const started = performance.now()
      adapter.search(fullIndex, query.term, query.locale)
      queryTimes.push(performance.now() - started)
    }
  }

  const ginkoQueryTimes = []
  for (let iteration = 0; iteration < queryIterations; iteration++) {
    for (const query of queries) {
      const started = performance.now()
      shape(adapter.search(fullIndex, query.term, query.locale), query.term)
      ginkoQueryTimes.push(performance.now() - started)
    }
  }

  const localeChecks = queries.filter(query => query.locale).map(query => {
    const results = adapter.search(fullIndex, query.term, query.locale)
    return {
      term: query.term,
      locale: query.locale,
      leakedLocales: [...new Set(results.map(result => result.locale).filter(locale => locale !== query.locale))]
    }
  })
  const allLanguageResults = adapter.search(fullIndex, 'guide')

  return {
    engine: adapter.name,
    relevance: {
      top1: relevance.filter(query => query.top1).length,
      top3: relevance.filter(query => query.top3).length,
      total: relevance.length,
      queries: relevance
    },
    assets: {
      serializedIndexBytes: bytes(serialized),
      serializedIndexGzipBytes: gzipSync(serialized).byteLength,
      browserRuntime: await measureBundle(adapter)
    },
    timingMs: {
      initialIndexMedian: round(median(buildTimes)),
      restoreMedian: round(median(restoreTimes)),
      engineQueryP95: round(percentile(queryTimes, 0.95)),
      ginkoQueryP95: round(percentile(ginkoQueryTimes, 0.95))
    },
    memory: {
      approximateHeapBytes: Math.max(0, heapAfter - heapBefore),
      note: 'Heap delta after forced GC; compare directionally on the same machine.'
    },
    locale: {
      isolatedQueries: localeChecks.every(check => check.leakedLocales.length === 0),
      checks: localeChecks,
      allLanguagesGuideLocales: [...new Set(allLanguageResults.map(result => result.locale).filter(Boolean))].sort()
    }
  }
}

const formatBytes = value => `${(value / 1024).toFixed(1)} KiB`
const toMarkdown = report => {
  const rows = report.engines.map(engine => `| ${engine.engine} | ${engine.relevance.top1}/${engine.relevance.total} | ${engine.relevance.top3}/${engine.relevance.total} | ${formatBytes(engine.assets.serializedIndexBytes)} / ${formatBytes(engine.assets.serializedIndexGzipBytes)} | ${formatBytes(engine.assets.browserRuntime.rawBytes)} / ${formatBytes(engine.assets.browserRuntime.gzipBytes)} | ${engine.timingMs.initialIndexMedian} | ${engine.timingMs.restoreMedian} | ${engine.timingMs.engineQueryP95} | ${engine.timingMs.ginkoQueryP95} | ${formatBytes(engine.memory.approximateHeapBytes)} | ${engine.locale.isolatedQueries ? 'pass' : 'fail'} |`)
  const queryDetails = report.engines.flatMap(engine => engine.relevance.queries.map(query => `| ${engine.engine} | \`${query.term}\` | ${query.locale || 'all'} | ${query.top1 ? 'yes' : 'no'} | ${query.top3 ? 'yes' : 'no'} | ${query.actualTop3.map(path => `\`${path}\``).join('<br>')} |`))
  return `# Search benchmark report

Generated: ${report.generatedAt}  
Runtime: ${report.environment.node} on ${report.environment.platform} (${report.environment.arch})  
Corpus: ${report.corpus.records} generated records, ${formatBytes(report.corpus.rawBytes)} raw / ${formatBytes(report.corpus.gzipBytes)} gzip

| Engine | Top 1 | Top 3 | Serialized index raw / gzip | Browser runtime raw / gzip | Initial index median ms | Restore median ms | Engine p95 ms | Ginko p95 ms | Approx. heap | Locale isolation |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
${rows.join('\n')}

## Golden query detail

| Engine | Query | Locale | Top 1 | Top 3 | Actual top 3 |
|---|---|---|---|---|---|
${queryDetails.join('\n')}

Heap and sub-millisecond timing numbers are directional and must be compared on the same machine. Relevance and locale isolation are correctness results.
`
}

const main = async () => {
  const corpora = await Promise.all(corpusSources.map(loadCorpus))
  const records = normalizeRecords(corpora)
  const queries = await readJson(goldenQueriesPath)
  const rawCorpus = JSON.stringify(records)
  const engines = []
  for (const adapter of [miniSearchAdapter, oramaAdapter]) {
    engines.push(await measureEngine(adapter, records, queries))
  }
  const report = {
    generatedAt: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    corpus: {
      sources: corpora.map(corpus => ({ name: corpus.name, records: corpus.records.length, artifact: corpus.artifact })),
      records: records.length,
      rawBytes: bytes(rawCorpus),
      gzipBytes: gzipSync(rawCorpus).byteLength
    },
    engines
  }

  await mkdir(outputDirectory, { recursive: true })
  await writeFile(resolve(outputDirectory, 'latest.json'), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(resolve(outputDirectory, 'latest.md'), toMarkdown(report))
  console.log(toMarkdown(report))
}

await main()
