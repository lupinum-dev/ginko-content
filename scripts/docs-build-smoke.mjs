#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const root = 'docs/.output/public'
const offenders = []
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
    if (hrefUndefinedPattern.test(source) || pathUndefinedPattern.test(source)) {
      offenders.push(relative(process.cwd(), path))
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

console.log('docs-build-smoke: OK')
