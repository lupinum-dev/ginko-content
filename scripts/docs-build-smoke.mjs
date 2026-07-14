#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { assertGeneratedLinkIntegrity } from './lib/generated-link-integrity.mjs'
import { measurePageAssetBudget } from './lib/asset-budget.mjs'

const root = 'docs/.output/public'
const offenders = []
const accessibilityOffenders = []
const generatedPages = []
const hrefUndefinedPattern = /href="[^"]*undefined/g
const pathUndefinedPattern = /\/undefined(?=["/?#])/g

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
    if (!outputPath.startsWith('api/')) {
      if (!/<html[^>]+lang="[^"]+"/i.test(source)) accessibilityOffenders.push(`${outputPath}: missing html lang`)
      if (!/<main(?:\s|>)/i.test(source)) accessibilityOffenders.push(`${outputPath}: missing main landmark`)
      if (outputPath.startsWith('docs/') && !/<h1(?:\s|>)/i.test(source)) accessibilityOffenders.push(`${outputPath}: missing h1`)
      const images = source.match(/<img\b[^>]*>/gi) || []
      if (images.some(image => !/\salt=/i.test(image))) accessibilityOffenders.push(`${outputPath}: image without alt`)
      if (/href="\s*"/i.test(source)) accessibilityOffenders.push(`${outputPath}: empty href`)
    }
    hrefUndefinedPattern.lastIndex = 0
    pathUndefinedPattern.lastIndex = 0
  }))
}

await walk(root)

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
