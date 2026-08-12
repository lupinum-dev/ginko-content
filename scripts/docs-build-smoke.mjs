#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { assertGeneratedLinkIntegrity } from './docs/generated-link-integrity.mjs'
import { measurePageAssetBudget } from './docs/asset-budget.mjs'

const root = 'docs/.output/public'
const offenders = []
const accessibilityOffenders = []
const generatedPages = []
const hrefUndefinedPattern = /href="[^"]*undefined/g
const pathUndefinedPattern = /\/undefined(?=["/?#])/g
const outputExists = async output => {
  try {
    await readFile(join(root, output))
    return true
  } catch {
    return false
  }
}

const walk = async (dir) => {
  const entries = await readdir(dir, { withFileTypes: true })
  await Promise.all(entries.map(async (entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(path)
      return
    }
    if (!entry.name.endsWith('.html')) return

    const source = await readFile(path, 'utf8')
    generatedPages.push({ path: relative(root, path).replaceAll('\\', '/'), html: source })
    if (hrefUndefinedPattern.test(source) || pathUndefinedPattern.test(source)) {
      offenders.push(relative(process.cwd(), path))
    }
    const outputPath = relative(root, path).replaceAll('\\', '/')
    const isMetaRefresh = /<meta\s+http-equiv=["']refresh["']/i.test(source)
    const isDocsEntryRedirect = outputPath === 'docs/index.html' && isMetaRefresh
    if (isDocsEntryRedirect && !/content=["'][^"']*url=\/docs\/get-started\/quickstart["']/i.test(source)) {
      accessibilityOffenders.push(`${outputPath}: unexpected redirect target`)
    }
    if (!isDocsEntryRedirect && (outputPath === 'index.html' || outputPath.startsWith('docs/'))) {
      if (!/<html[^>]+lang="[^"]+"/i.test(source)) accessibilityOffenders.push(`${outputPath}: missing html lang`)
      if (!/<main(?:\s|>)/i.test(source)) accessibilityOffenders.push(`${outputPath}: missing main landmark`)
      if (outputPath !== 'docs/index.html' && outputPath.startsWith('docs/') && !/<h1(?:\s|>)/i.test(source)) accessibilityOffenders.push(`${outputPath}: missing h1`)
      const images = source.match(/<img\b[^>]*>/gi) || []
      if (images.some(image => !/\salt=/i.test(image))) accessibilityOffenders.push(`${outputPath}: image without alt`)
      if (/href="\s*"/i.test(source)) accessibilityOffenders.push(`${outputPath}: empty href`)
    }
    hrefUndefinedPattern.lastIndex = 0
    pathUndefinedPattern.lastIndex = 0
  }))
}

await walk(root)

const requiredOutputs = [
  'index.html',
  'docs/get-started/quickstart/index.html',
  'docs/build/documentation-site/index.html',
  'docs/concepts/why-ginko/index.html',
  'docs/guides/agent-readable-output/index.html',
  'docs/reference/query-api/index.html',
  'docs/migration/from-nuxt-content-v3/index.html',
  'docs/resources/troubleshooting/index.html',
  'raw/docs/get-started/quickstart.md',
  'raw/docs/concepts/why-ginko.md',
  'raw/docs/reference/query-api.md',
  'llms.txt',
  'llms-full.txt'
]
const retiredOutputs = [
  'docs/why-ginko/index.html',
  'docs/why-ginko/how-ginko-compares/index.html',
  'docs/how-it-works/index.html',
  'docs/get-started/installation/index.html',
  'docs/guides/site-patterns/documentation-site/index.html',
  'raw/docs/why-ginko.md',
  'docs/getting-started/index.html',
  'docs/essentials/index.html',
  'docs/collections/index.html',
  'docs/querying/index.html',
  'docs/rendering/index.html',
  'docs/i18n/index.html',
  'docs/search/index.html',
  'docs/api-reference/index.html',
  'docs/cms-cache/index.html'
]
const publicSansOutputs = [400, 500, 600, 700]
  .map(weight => `fonts/public-sans/public-sans-${weight}-normal-latin.woff`)
const missingOutputs = []
const unexpectedRetiredOutputs = []

for (const output of [...requiredOutputs, ...publicSansOutputs, 'fonts/public-sans/LICENSE', 'fonts/public-sans/README.md']) {
  if (!await outputExists(output)) missingOutputs.push(output)
}

for (const output of retiredOutputs) {
  if (await outputExists(output)) unexpectedRetiredOutputs.push(output)
}

if (missingOutputs.length > 0 || unexpectedRetiredOutputs.length > 0) {
  console.error('docs-build-smoke: generated route tree does not match the documentation cutover')
  for (const output of missingOutputs) console.error(`  missing ${output}`)
  for (const output of unexpectedRetiredOutputs) console.error(`  retired route still exists: ${output}`)
  process.exit(1)
}

const llms = await readFile(join(root, 'llms.txt'), 'utf8')
const llmsFull = await readFile(join(root, 'llms-full.txt'), 'utf8')
const quickstartMarkdown = await readFile(join(root, 'raw/docs/get-started/quickstart.md'), 'utf8')
const whyGinkoMarkdown = await readFile(join(root, 'raw/docs/concepts/why-ginko.md'), 'utf8')
const agentOutputProblems = []

for (const expected of [
  '[Quickstart](https://ginko-content.lupinum.com/raw/docs/get-started/quickstart.md)',
  '[Why Ginko (and when not)](https://ginko-content.lupinum.com/raw/docs/concepts/why-ginko.md)',
  '[Build a documentation site](https://ginko-content.lupinum.com/raw/docs/build/documentation-site.md)',
  '[Query API](https://ginko-content.lupinum.com/raw/docs/reference/query-api.md)',
  '[From Nuxt Content v3](https://ginko-content.lupinum.com/raw/docs/migration/from-nuxt-content-v3.md)'
]) {
  if (!llms.includes(expected)) agentOutputProblems.push(`llms.txt is missing ${expected}`)
}

for (const retiredUrl of [
  '/raw/docs/getting-started.md',
  '/raw/docs/essentials.md',
  '/raw/docs/api-reference.md'
]) {
  if (llms.includes(retiredUrl)) agentOutputProblems.push(`llms.txt contains retired URL ${retiredUrl}`)
}

for (const heading of ['# Why Ginko (and when not)', '# Query API', '# From Nuxt Content v3']) {
  if (!llmsFull.includes(heading)) agentOutputProblems.push(`llms-full.txt is missing ${heading}`)
}

if (!quickstartMarkdown.includes('title: "Quickstart"') || !quickstartMarkdown.includes('## Install')) {
  agentOutputProblems.push('raw Quickstart Markdown is not the canonical page content')
}

if (!whyGinkoMarkdown.includes('# Why Ginko (and when not)') || !whyGinkoMarkdown.includes('## Who it fits')) {
  agentOutputProblems.push('raw Why Ginko Markdown is not the canonical page content')
}

if (agentOutputProblems.length > 0) {
  console.error('docs-build-smoke: agent-readable documentation is incomplete')
  for (const problem of agentOutputProblems) console.error(`  ${problem}`)
  process.exit(1)
}

if (offenders.length > 0) {
  console.error('docs-build-smoke: generated docs contain undefined links')
  for (const offender of offenders) console.error(`  ${offender}`)
  process.exit(1)
}

if (accessibilityOffenders.length > 0) {
  console.error('docs-build-smoke: generated docs failed accessibility structure checks')
  for (const offender of accessibilityOffenders) console.error(`  ${offender}`)
  process.exit(1)
}

const assetDirectory = join(root, '_nuxt')
const cssAssets = (await readdir(assetDirectory)).filter(asset => asset.endsWith('.css'))
const cssSources = await Promise.all(cssAssets.map(asset => readFile(join(assetDirectory, asset), 'utf8')))
const missingFontReferences = publicSansOutputs.filter(output => !cssSources.some(source => source.includes(output.split('/').at(-1))))
const remoteFontOrigins = [
  'fonts.gstatic.com',
  'fonts.google.com',
  'api.fontsource.org',
  'fonts.bunny.net',
  'cdn.jsdelivr.net/npm/@fontsource'
].filter(origin => cssSources.some(source => source.includes(origin)))

if (missingFontReferences.length > 0 || remoteFontOrigins.length > 0) {
  console.error('docs-build-smoke: documentation fonts are not fully self-hosted')
  for (const output of missingFontReferences) console.error(`  missing CSS reference for ${output}`)
  for (const origin of remoteFontOrigins) console.error(`  remote font origin present: ${origin}`)
  process.exit(1)
}

const { maxPage, largestAsset } = await measurePageAssetBudget(generatedPages, asset => readFile(join(assetDirectory, asset)))
const totalBudget = 700 * 1024
const individualBudget = 230 * 1024

if (maxPage.gzipBytes > totalBudget || largestAsset.gzipBytes > individualBudget) {
  console.error('docs-build-smoke: generated docs exceeded the asset budget')
  console.error(`  largest initial page payload: ${maxPage.path} ${(maxPage.gzipBytes / 1024).toFixed(1)} KiB gzip (budget 700 KiB)`)
  if (largestAsset.asset) console.error(`  largest referenced asset: ${largestAsset.asset} ${(largestAsset.gzipBytes / 1024).toFixed(1)} KiB gzip (budget 230 KiB)`)
  process.exit(1)
}

await assertGeneratedLinkIntegrity(root)

console.log('docs-build-smoke: OK')
