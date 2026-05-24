import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { describe, expect, test } from 'vitest'

const markdownRoots = [
  'README.md',
  'packages/content/README.md',
  'packages/content/ARCHITECTURE.md',
  'packages/content/docs',
  'docs/content',
  'skills/ginko-content',
  'meta/skill',
  'meta/ARCHITECTURE.md',
  'meta/ABSTRACTIONS.md',
  'meta/VISION.md'
]

const exampleRoots = [
  'examples',
  'docs/app',
  'docs/server'
]

const stalePublicApiPatterns = [
  /(^|[^A-Za-z0-9_])queryCollection([^A-Za-z0-9_]|$)/,
  /\bqueryCollectionNavigation\b/,
  /\bqueryCollectionPage\b/,
  /\bserverQueryCollection\b/,
  /\bresolveContentReference\b/,
  /\buseContentList\b/,
  /\buseContentNavigation\b/,
  /\buseContentSwitchLocalePath\b/
]

const publicQueryOperators = new Set([
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$contains',
  '$containsAny',
  '$icontains',
  '$exists',
  '$type',
  '$prefix',
  '$and',
  '$or',
  '$not'
])

const nonQueryDollarNames = new Set([
  '$attrs',
  '$doc',
  '$fetch',
  '$ginko',
  '$route'
])

const isCheckedTextFile = (file: string) =>
  ['.md', '.vue', '.ts', '.js', '.mjs'].some(extension => file.endsWith(extension))

const skippedDirectories = new Set([
  '.nuxt',
  '.output',
  'dist',
  'node_modules'
])

const collectCheckedTextFiles = async (path: string): Promise<string[]> => {
  const entries = await readdir(path, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(path, entry.name)
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) return []
      return await collectCheckedTextFiles(entryPath)
    }
    return isCheckedTextFile(entry.name) ? [entryPath] : []
  }))
  return nested.flat()
}

const collectTextFiles = async (roots: string[]) => {
  const files = await Promise.all(roots.map(async (root) => {
    if (isCheckedTextFile(root)) return [root]
    return await collectCheckedTextFiles(root)
  }))
  return files
    .flat()
    .map(file => relative(process.cwd(), file))
}

const isMigrationDoc = (file: string) => file.split('\\').join('/').startsWith('docs/content/docs/8.migration/')

const isHistoricalMigrationLine = (lines: string[], index: number) => {
  const context = lines
    .slice(Math.max(0, index - 4), index + 1)
    .join(' ')
    .toLowerCase()

  return [
    'old api',
    'old ginko api',
    'before',
    'replace',
    'removed',
    'legacy',
    'nuxt content v2',
    'nuxt content v3',
    'v3-only',
    'if you see'
  ].some(marker => context.includes(marker))
}

const findStalePublicApiLines = (file: string, source: string) => {
  const lines = source.split('\n')
  return lines.flatMap((line, index) => {
    if (!stalePublicApiPatterns.some(pattern => pattern.test(line))) {
      return []
    }

    if (isMigrationDoc(file) && isHistoricalMigrationLine(lines, index)) {
      return []
    }

    return [`${file}:${index + 1}`]
  })
}

const isUnsupportedOperatorExample = (lines: string[], index: number) => {
  const context = lines
    .slice(Math.max(0, index - 4), index + 4)
    .join(' ')
    .toLowerCase()

  return [
    'do not accept',
    'does not accept',
    'reject',
    'unsupported',
    'fail',
    'not supported'
  ].some(marker => context.includes(marker))
}

const findUnsupportedPublicOperatorLines = (file: string, source: string) => {
  const lines = source.split('\n')
  return lines.flatMap((line, index) => {
    const operators = line.match(/\$[a-z][a-z0-9_]*/gi) ?? []
    const unsupported = operators.filter(operator =>
      !publicQueryOperators.has(operator) &&
      !nonQueryDollarNames.has(operator)
    )
    if (unsupported.length === 0) return []
    if (isUnsupportedOperatorExample(lines, index)) return []
    return [`${file}:${index + 1} (${unsupported.join(', ')})`]
  })
}

describe('documentation drift', () => {
  test('stale API detector allows current sitemap helper names', () => {
    expect(stalePublicApiPatterns.some(pattern => pattern.test('queryCollectionsSitemapEntries'))).toBe(false)
    expect(stalePublicApiPatterns.some(pattern => pattern.test('queryCollection('))).toBe(true)
    expect(stalePublicApiPatterns.some(pattern => pattern.test('`useContentPage`'))).toBe(false)
    expect(stalePublicApiPatterns.some(pattern => pattern.test('useContentList('))).toBe(true)
    expect(stalePublicApiPatterns.some(pattern => pattern.test('queryCollectionNavigation('))).toBe(true)
  })

  test('current public docs do not teach removed query APIs', async () => {
    const offenders: string[] = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots])) {
      const source = await readFile(file, 'utf8')
      offenders.push(...findStalePublicApiLines(file, source))
    }

    expect(offenders).toEqual([])
  })

  test('docs and examples do not teach unsupported public query operators', async () => {
    const offenders: string[] = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots])) {
      const source = await readFile(file, 'utf8')
      offenders.push(...findUnsupportedPublicOperatorLines(file, source))
    }

    expect(offenders).toEqual([])
  })
})
