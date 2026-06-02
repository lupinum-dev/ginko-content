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

const sourceExampleFiles = [
  'packages/content/src/types/config.ts'
]

const stalePublicApiPatterns = [
  /(^|[^A-Za-z0-9_])queryCollection([^A-Za-z0-9_]|$)/,
  /\bqueryCollectionNavigation\b/,
  /\bqueryCollectionPage\b/,
  /\bserverQueryCollection\b/,
  /\bresolveContentReference\b/,
  /\buseContentList\b/,
  /\buseContentSwitchLocalePath\b/
]

const namedDefineCollectionPattern = /\bdefineCollection\s*\(\s*['"][^'"]+['"]/

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

const normalizePath = (file: string) => file.split('\\').join('/')

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
    'old nuxt content',
    'nuxt content v2',
    'nuxt content v3',
    'v3 guide',
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

const isCompatibilityCollectionDeclarationLine = (lines: string[], index: number) => {
  const context = lines
    .slice(Math.max(0, index - 3), index + 3)
    .join(' ')
    .toLowerCase()

  return [
    'older',
    'compatibility',
    'authored name must match',
    'must match definecollection name',
    'old api',
    'before'
  ].some(marker => context.includes(marker))
}

const findNamedDefineCollectionLines = (file: string, source: string) => {
  const lines = source.split('\n')
  return lines.flatMap((line, index) => {
    if (!namedDefineCollectionPattern.test(line)) return []
    if (isMigrationDoc(file) && isHistoricalMigrationLine(lines, index)) return []
    if (isCompatibilityCollectionDeclarationLine(lines, index)) return []
    return [`${file}:${index + 1}`]
  })
}

const isFallbackAwareDoc = (file: string) => {
  const normalized = normalizePath(file)
  return (
    normalized.includes('/6.i18n/') ||
    normalized.includes('/8.migration/') ||
    normalized.includes('/9.api-reference/') ||
    normalized.toLowerCase().includes('i18n') ||
    normalized.toLowerCase().includes('fallback')
  )
}

const findUnapprovedFallbackLines = (file: string, source: string) => {
  if (isFallbackAwareDoc(file)) return []
  return source
    .split('\n')
    .flatMap((line, index) => line.includes('fallback: true') ? [`${file}:${index + 1}`] : [])
}

const collectExportedContentConfigHandles = (source: string) => {
  const handles = new Set<string>()
  const exportPattern = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*defineCollection\s*\(/g

  for (const match of source.matchAll(exportPattern)) {
    handles.add(match[1]!)
  }

  return handles
}

const findMissingContentConfigHandleImports = (
  file: string,
  source: string,
  exportedHandles: Set<string>
) => {
  const offenders: string[] = []
  const importPattern = /import\s*\{\s*([^}]+?)\s*\}\s*from\s*['"]~\/content\.config['"]/g
  if (exportedHandles.size === 0) return offenders

  for (const match of source.matchAll(importPattern)) {
    const imported = match[1]!
      .split(',')
      .map(entry => entry.trim().split(/\s+as\s+/i)[0]?.trim())
      .filter((entry): entry is string => Boolean(entry))

    for (const handle of imported) {
      if (!exportedHandles.has(handle)) {
        const line = source.slice(0, match.index).split('\n').length
        offenders.push(`${file}:${line} (${handle})`)
      }
    }
  }

  return offenders
}

const extractMarkdownCodeBlocks = (source: string) => {
  const blocks: Array<{ info: string, code: string, startLine: number }> = []
  const blockPattern = /^```([^\n]*)\n([\s\S]*?)^```/gm

  for (const match of source.matchAll(blockPattern)) {
    blocks.push({
      info: match[1]?.trim() ?? '',
      code: match[2] ?? '',
      startLine: source.slice(0, match.index).split('\n').length
    })
  }

  return blocks
}

const isContentConfigCodeBlock = (info: string) =>
  /\bcontent\.config\.ts\b/.test(info)

const findIncompleteContentConfigSnippetLines = (file: string, source: string) => {
  const collectionExportPattern = /\bexport\s+const\s+[A-Za-z_$][\w$]*\s*=\s*defineCollection\s*\(/
  const contentConfigCallPattern = /\bdefineContentConfig\s*\(/
  const defaultContentConfigPattern = /\bexport\s+default\s+defineContentConfig\s*\(/

  return extractMarkdownCodeBlocks(source).flatMap(({ info, code, startLine }) => {
    if (!isContentConfigCodeBlock(info)) return []
    if (collectionExportPattern.test(code) && !defaultContentConfigPattern.test(code)) {
      return [`${file}:${startLine}`]
    }
    if (contentConfigCallPattern.test(code) && !defaultContentConfigPattern.test(code)) {
      return [`${file}:${startLine}`]
    }
    return []
  })
}

describe('documentation drift', () => {
  test('stale API detector allows current sitemap helper names', () => {
    expect(stalePublicApiPatterns.some(pattern => pattern.test('queryCollectionsSitemapEntries'))).toBe(false)
    expect(stalePublicApiPatterns.some(pattern => pattern.test('queryCollection('))).toBe(true)
    expect(stalePublicApiPatterns.some(pattern => pattern.test('`useContentPage`'))).toBe(false)
    expect(stalePublicApiPatterns.some(pattern => pattern.test('useContentList('))).toBe(true)
    expect(stalePublicApiPatterns.some(pattern => pattern.test('queryCollectionNavigation('))).toBe(true)
    expect(stalePublicApiPatterns.some(pattern => pattern.test('useContentNavigation('))).toBe(false)
  })

  test('content.config import detector is scoped to the same doc', () => {
    const source = [
      "export const docs = defineCollection('docs', { type: 'page' })",
      "import { docs, posts } from '~/content.config'"
    ].join('\n')

    expect(findMissingContentConfigHandleImports(
      'example.md',
      source,
      collectExportedContentConfigHandles(source)
    )).toEqual(['example.md:2 (posts)'])
  })

  test('content.config snippet detector requires full exported config files', () => {
    expect(findIncompleteContentConfigSnippetLines(
      'example.md',
      [
        '```ts [content.config.ts]',
        "export const docs = defineCollection('docs', { type: 'page' })",
        '```'
      ].join('\n')
    )).toEqual(['example.md:1'])
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

  test('current docs do not teach authored collection names as the default', async () => {
    const offenders: string[] = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots, ...sourceExampleFiles])) {
      const source = await readFile(file, 'utf8')
      offenders.push(...findNamedDefineCollectionLines(file, source))
    }

    expect(offenders).toEqual([])
  })

  test('fallback examples stay in fallback-aware docs', async () => {
    const offenders: string[] = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots, ...sourceExampleFiles])) {
      const source = await readFile(file, 'utf8')
      offenders.push(...findUnapprovedFallbackLines(file, source))
    }

    expect(offenders).toEqual([])
  })

  test('content.config imports reference exported collection handles shown in docs', async () => {
    const files = await collectTextFiles([...markdownRoots, ...exampleRoots, ...sourceExampleFiles])
    const sources = await Promise.all(files.map(async file => ({
      file,
      source: await readFile(file, 'utf8')
    })))

    const offenders = sources.flatMap(({ file, source }) =>
      findMissingContentConfigHandleImports(file, source, collectExportedContentConfigHandles(source))
    )

    expect(offenders).toEqual([])
  })

  test('content.config snippets are complete exported configs', async () => {
    const offenders: string[] = []
    for (const file of await collectTextFiles(markdownRoots)) {
      const source = await readFile(file, 'utf8')
      offenders.push(...findIncompleteContentConfigSnippetLines(file, source))
    }

    expect(offenders).toEqual([])
  })
})
