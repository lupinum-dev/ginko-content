#!/usr/bin/env node
// Documentation-drift linter.
//
// Scans the shipped docs and examples for
// stale/removed public APIs, private metadata leaks, unsupported query
// operators, incomplete config snippets, and non-public imports. It runs in CI
// through `verify` and `release:verify`.
//
// Exit code 0 = clean; 1 = drift found (offenders printed to stderr).

import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { LOGICAL_QUERY_OPERATORS, PUBLIC_QUERY_OPERATORS } from '../packages/content/src/core/query/operators.ts'

const markdownRoots = [
  'README.md',
  'packages/content/README.md',
  'packages/content/docs',
  'docs/content',
  'skills/ginko-content',
  'meta/adr',
  'meta/ARCHITECTURE.md',
  'meta/ABSTRACTIONS.md',
  'meta/VISION.md'
]

const exampleRoots = [
  'examples',
  'docs/app',
  'docs/server'
]

const exampleImportRoots = [
  ...exampleRoots,
  'playground',
  'test/fixtures'
]

// Maintained public-contract fixtures. Scanned alongside docs/examples by
// contract-oriented detectors, but excluded from beginner-documentation
// placement checks because they are executable fixtures rather than teaching
// material.
const maintainedFixtureRoots = [
  'test/fixtures/typecheck',
  'test/fixtures/quickstart'
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
  /\buseContentRoute\b/,
  /\buseContentLocaleSwitch\b/
]

const advancedServerSurfacePatterns = [
  /\bwithContentCache\b/,
  /\bcontentCacheHeaders\b/,
  /\bnoopContentCache\b/,
  /\bContentCacheAdapter\b/,
  /\bContentCacheHint\b/,
  /\bContentProvider\b/,
  /\bcreateContentProviderError\b/,
  /\bdefineAgentMarkdownComponent\b/,
  /\bregisterAgentMarkdown/,
  /\bagentRawPathForRoute\b/,
  /\bagentMarkdownPathForRoute\b/,
  /\brenderLlmsTxt\b/,
  /\brenderLlmsFullTxt\b/,
  /\bresolveContentMarkdown\b/
]

const privateLocaleMetadataPatterns = [
  /\b_requestedLocale\b/,
  /\b_resolvedLocale\b/,
  /\b_fallback\b/,
  /\b_availableLocales\b/,
  /\b_variantPaths\b/
]

const currentEnvelopeMetadataPatterns = [
  /\b_path\b/,
  /\b_id\b/,
  /\b_file\b/,
  /\b_locale\b/,
  /\b_stem\b/,
  /\b_dir\b/,
  /\b_extension\b/
]

const namedDefineCollectionPattern = /\bdefineCollection\s*\(\s*['"][^'"]+['"]/

const rawStringHandleFirstHelperPattern = /\b(?:useContentPage|useContentNavigation|useContentSearchData)\s*\(\s*['"][^'"]+['"]/

const publicQueryOperators = new Set([
  ...PUBLIC_QUERY_OPERATORS,
  ...LOGICAL_QUERY_OPERATORS
])

const nonQueryDollarNames = new Set([
  '$attrs',
  '$doc',
  '$event',
  '$fetch',
  '$ginko',
  '$route'
])

const isCheckedTextFile = file =>
  ['.json', '.md', '.vue', '.ts', '.js', '.mjs', '.yml', '.yaml'].some(extension => file.endsWith(extension))

const skippedDirectories = new Set([
  '.nuxt',
  '.output',
  'dist',
  'node_modules'
])

const collectCheckedTextFiles = async (path) => {
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return []
    throw error
  }
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

const collectTextFiles = async (roots) => {
  const files = await Promise.all(roots.map(async (root) => {
    if (isCheckedTextFile(root)) return [root]
    return await collectCheckedTextFiles(root)
  }))
  return files
    .flat()
    .map(file => relative(process.cwd(), file))
}

const isMigrationDoc = file => file.split('\\').join('/').startsWith('docs/content/docs/6.migration/')

const normalizePath = file => file.split('\\').join('/')

// ADRs are decision *records*, not tutorials: by genre they quote removed,
// rejected, and superseded APIs verbatim in Context/Alternatives/"old vs new"
// sections (that is the point of an ADR). The stale-API/private-metadata/
// operator-currency detectors below are built to protect docs that teach the
// *current* API to users; running them line-by-line against ADR prose would
// either flag legitimate historical quotation as "drift" or require every ADR
// author to route history through the migration-doc marker vocabulary. ADRs
// get the same "not a currency-checked doc" treatment as ARCHITECTURE.md /
// ABSTRACTIONS.md instead. Their factual accuracy is enforced by the
// dedicated ADR frontmatter check and current documentation invariants.
const isAdrDoc = file => normalizePath(file).startsWith('meta/adr/')

const isAdvancedSurfaceDoc = (file) => {
  const normalized = normalizePath(file)
  const lower = normalized.toLowerCase()
  return (
    normalized.includes('/6.migration/') ||
    normalized.includes('/5.reference/') ||
    normalized.includes('/4.guides/5.providers/') ||
    lower.includes('/advanced/') ||
    lower.includes('agent') ||
    lower.includes('provider') ||
    lower.includes('data-source') ||
    lower.includes('data_source') ||
    lower.includes('cache') ||
    lower.includes('cms_contract') ||
    lower.includes('public-surface') ||
    normalized.endsWith('ARCHITECTURE.md') ||
    normalized.endsWith('ABSTRACTIONS.md') ||
    isAdrDoc(file)
  )
}

const isHistoricalMigrationLine = (lines, index) => {
  const context = lines
    .slice(Math.max(0, index - 4), index + 1)
    .join(' ')
    .toLowerCase()

  return [
    'old api',
    'old ginko api',
    'older shape',
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

const findStalePublicApiLines = (file, source) => {
  if (isAdrDoc(file)) return []
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

const findAdvancedSurfaceLinesOutsideAdvancedDocs = (file, source) => {
  if (isAdvancedSurfaceDoc(file)) return []
  return source.split('\n').flatMap((line, index) => {
    if (!advancedServerSurfacePatterns.some(pattern => pattern.test(line))) {
      return []
    }

    return [`${file}:${index + 1}`]
  })
}

const findPrivateLocaleMetadataLines = (file, source) => {
  if (isAdrDoc(file)) return []
  const lines = source.split('\n')
  return lines.flatMap((line, index) => {
    if (!privateLocaleMetadataPatterns.some(pattern => pattern.test(line))) {
      return []
    }

    if (isMigrationDoc(file) && isHistoricalMigrationLine(lines, index)) {
      return []
    }

    return [`${file}:${index + 1}`]
  })
}

const findCurrentEnvelopeMetadataLines = (file, source) => {
  if (isAdrDoc(file)) return []
  const lines = source.split('\n')
  return lines.flatMap((line, index) => {
    if (!currentEnvelopeMetadataPatterns.some(pattern => pattern.test(line))) {
      return []
    }

    if (isMigrationDoc(file) && isHistoricalMigrationLine(lines, index)) {
      return []
    }

    return [`${file}:${index + 1}`]
  })
}

const isUnsupportedOperatorExample = (lines, index) => {
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

const isMarkdownRefLinkExample = (lines, index) => {
  const line = lines[index] || ''
  if (/\]\(\$[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*(?:#[^)]+)?\)/i.test(line)) {
    return true
  }

  const context = lines
    .slice(Math.max(0, index - 4), index + 4)
    .join(' ')
    .toLowerCase()

  if (/`\$[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)*(?:#[^`]*)?`/i.test(line)) {
    return context.includes('link') ||
      context.includes('route') ||
      context.includes('document') ||
      context.includes('locale')
  }

  return context.includes('markdown') &&
    (context.includes('ref') || context.includes('reference')) &&
    (context.includes('link') || context.includes('links'))
}

const findUnsupportedPublicOperatorLines = (file, source) => {
  if (isAdrDoc(file)) return []
  const lines = source.split('\n')
  return lines.flatMap((line, index) => {
    const operators = line.match(/\$[a-z][a-z0-9_]*/gi) ?? []
    const unsupported = operators.filter(operator =>
      !publicQueryOperators.has(operator) &&
      !nonQueryDollarNames.has(operator)
    )
    if (unsupported.length === 0) return []
    if (isUnsupportedOperatorExample(lines, index)) return []
    if (isMarkdownRefLinkExample(lines, index)) return []
    return [`${file}:${index + 1} (${unsupported.join(', ')})`]
  })
}

const isCompatibilityCollectionDeclarationLine = (lines, index) => {
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

const findNamedDefineCollectionLines = (file, source) => {
  if (isAdrDoc(file)) return []
  const lines = source.split('\n')
  return lines.flatMap((line, index) => {
    if (!namedDefineCollectionPattern.test(line)) return []
    if (isMigrationDoc(file) && isHistoricalMigrationLine(lines, index)) return []
    if (isCompatibilityCollectionDeclarationLine(lines, index)) return []
    return [`${file}:${index + 1}`]
  })
}

const findRawStringHandleFirstHelperLines = (file, source) => {
  if (isAdrDoc(file)) return []
  const lines = source.split('\n')
  return source
    .split('\n')
    .flatMap((line, index) =>
      rawStringHandleFirstHelperPattern.test(line) && !isHistoricalMigrationLine(lines, index)
        ? [`${file}:${index + 1}`]
        : []
    )
}

const isFallbackAwareDoc = (file) => {
  const normalized = normalizePath(file)
  return (
    normalized.includes('/2.build/3.multilingual-site') ||
    normalized.includes('/4.guides/7.translated-slugs') ||
    normalized.includes('/4.guides/6.routes-links-and-redirects') ||
    normalized.includes('/6.migration/') ||
    normalized.includes('/5.reference/') ||
    normalized.toLowerCase().includes('i18n') ||
    normalized.toLowerCase().includes('fallback') ||
    isAdrDoc(file)
  )
}

const findUnapprovedFallbackLines = (file, source) => {
  if (isFallbackAwareDoc(file)) return []
  return source
    .split('\n')
    .flatMap((line, index) => line.includes('fallback: true') ? [`${file}:${index + 1}`] : [])
}

const collectExportedContentConfigHandles = (source) => {
  const handles = new Set()
  const exportPattern = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*defineCollection\s*\(/g

  for (const match of source.matchAll(exportPattern)) {
    handles.add(match[1])
  }

  return handles
}

const findMissingContentConfigHandleImports = (file, source, exportedHandles) => {
  const offenders = []
  const importPattern = /import\s*\{\s*([^}]+?)\s*\}\s*from\s*['"]~\/content\.config['"]/g
  if (exportedHandles.size === 0) return offenders

  for (const match of source.matchAll(importPattern)) {
    const imported = match[1]
      .split(',')
      .map(entry => entry.trim().split(/\s+as\s+/i)[0]?.trim())
      .filter(entry => Boolean(entry))

    for (const handle of imported) {
      if (!exportedHandles.has(handle)) {
        const line = source.slice(0, match.index).split('\n').length
        offenders.push(`${file}:${line} (${handle})`)
      }
    }
  }

  return offenders
}

const extractMarkdownCodeBlocks = (source) => {
  const blocks = []
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

const collectPublicPackageSubpaths = async () => {
  const manifest = JSON.parse(await readFile('packages/content/package.json', 'utf8'))

  return Object.keys(manifest.exports)
    .map(subpath => subpath === '.' ? '@lupinum/ginko-content' : `@lupinum/ginko-content${subpath.slice(1)}`)
}

const extractImportSpecifiers = (source) => {
  const specifiers = new Set()
  for (const match of source.matchAll(/\bimport(?:\s+type)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    specifiers.add(match[1] ?? match[2] ?? '')
  }
  return [...specifiers].filter(Boolean)
}

const findNonPublicGinkoImportLines = (file, source, publicSubpaths) => {
  const allowed = new Set(publicSubpaths)
  const wildcardPrefixes = publicSubpaths
    .filter(subpath => subpath.endsWith('/*'))
    .map(subpath => subpath.slice(0, -1))

  return source.split('\n').flatMap((line, index) => {
    const offenders = extractImportSpecifiers(line)
      .filter(specifier => specifier.startsWith('@lupinum/ginko-content'))
      .filter(specifier =>
        !allowed.has(specifier) &&
        !wildcardPrefixes.some(prefix => specifier.startsWith(prefix))
      )

    return offenders.length ? [`${file}:${index + 1} (${offenders.join(', ')})`] : []
  })
}

const findNuxtContentImports = (file, source) =>
  source.split('\n').flatMap((line, index) => {
    const specifiers = extractImportSpecifiers(line)
    return specifiers.includes('@nuxt/content') ? [`${file}:${index + 1}`] : []
  })

const peerRequirementLabel = (name, range) => {
  const version = range.match(/\d+(?:\.\d+)*/)?.[0]
  if (!version) return null
  if (name === 'nuxt') return range.includes('<5')
    ? `Nuxt ${version} through Nuxt 4.x`
    : `Nuxt ${version} or later`
  if (name === 'vue') return range.startsWith('^')
    ? `Vue ${version} through Vue ${version.split('.')[0]}.x`
    : `Vue ${version} or later`
  return null
}

const nodeRequirementLabel = (range) => {
  const bounded = [...range.matchAll(/\^(\d+)\.(\d+)\.\d+/g)]
    .map(match => `${match[1]}.${match[2]}–${match[1]}.x`)
  const open = range.match(/>=(\d+)(?:\.\d+){2}/)?.[1]
  const parts = [...bounded, ...(open ? [`${open}+`] : [])]
  if (!parts.length) return null
  const joined = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')}, or ${parts.at(-1)}`
  return `Node.js ${joined}`
}

const isContentConfigCodeBlock = info => /\bcontent\.config\.ts\b/.test(info)

const findIncompleteContentConfigSnippetLines = (file, source) => {
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

const parseFrontmatter = (source) => {
  const match = source.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const frontmatter = {}
  for (const line of match[1].split('\n')) {
    const fieldMatch = line.match(/^([A-Z0-9_]+):\s*(.*)$/i)
    if (!fieldMatch) continue
    frontmatter[fieldMatch[1]] = fieldMatch[2].trim().replace(/^"(.*)"$/, '$1')
  }
  return frontmatter
}

const genericDiscoveryHeadings = new Set([
  "## what's next",
  '## next steps',
  '## related',
  '## see also'
])

const findGenericDiscoveryFooterLines = (file, source) =>
  source.split('\n').flatMap((line, index) => {
    const normalized = line.trim().toLowerCase().replaceAll('’', "'")
    return genericDiscoveryHeadings.has(normalized) || normalized.startsWith('**next:**')
      ? [`${file}:${index + 1}`]
      : []
  })

const findBodyTitleLines = (file, source) => {
  const lines = source.split('\n')
  let inFrontmatter = lines[0] === '---'
  let inFence = false

  return lines.flatMap((line, index) => {
    if (index === 0 && inFrontmatter) return []
    if (inFrontmatter) {
      if (line === '---') inFrontmatter = false
      return []
    }

    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      return []
    }

    return !inFence && /^#\s+/.test(line) ? [`${file}:${index + 1}`] : []
  })
}

const findAppRelativeContentConfigImports = (file, source) =>
  source.split('\n').flatMap((line, index) =>
    /from\s+['"]~\/content\.config(?:\.[cm]?[jt]s)?['"]/.test(line)
      ? [`${file}:${index + 1}`]
      : []
  )

// Structural (not prose) check: every ADR file's frontmatter `id` matches its
// filename's numeric prefix, has the required fields, and its status is
// reflected in meta/adr/README.md's index table. Catches an ADR whose id/status
// drifted from the index without depending on exact ADR wording — safe to run
// even while ADR content itself (0006/0007/0009) is being corrected elsewhere.
const findAdrIndexDriftOffenders = async () => {
  const offenders = []
  const adrFiles = (await collectCheckedTextFiles('meta/adr'))
    .map(file => relative(process.cwd(), file))
    .filter(file => /meta\/adr\/\d{4}-.*\.md$/.test(normalizePath(file)))

  const readmePath = 'meta/adr/README.md'
  const readme = await readFile(readmePath, 'utf8')

  for (const file of adrFiles) {
    const source = await readFile(file, 'utf8')
    const frontmatter = parseFrontmatter(source)
    const filenameId = normalizePath(file).match(/(\d{4})-/)?.[1]

    if (!frontmatter) {
      offenders.push(`${file}: missing frontmatter block`)
      continue
    }
    for (const field of ['type', 'id', 'title', 'status', 'date']) {
      if (!frontmatter[field]) offenders.push(`${file}: frontmatter missing "${field}"`)
    }
    if (frontmatter.id && frontmatter.id !== filenameId) {
      offenders.push(`${file}: frontmatter id "${frontmatter.id}" does not match filename prefix "${filenameId}"`)
    }
    const idForIndex = frontmatter.id || filenameId
    if (idForIndex && !readme.includes(`| ${idForIndex} `) && !readme.includes(`| ${idForIndex}\t`)) {
      offenders.push(`${readmePath}: no index row for ADR ${idForIndex} (${file})`)
    }
  }

  return offenders
}

// Every regex-backed detector is self-tested against `positive-controls.md`:
// each pattern must still match a known-bad fixture line, so a regex regression
// (e.g. a broken escape) fails loudly instead of silently passing every doc.
// This includes every single-pattern detector. The
// remaining checks are heuristic (context windows, relational import/export
// matching, code-block completeness, peer-version labels) rather than a fixed
// pattern.test over one line, so they cannot be fixture-tested this way.
const patternGroups = [
  { name: 'stale-public-api', patterns: stalePublicApiPatterns },
  { name: 'advanced-server-surface', patterns: advancedServerSurfacePatterns },
  { name: 'private-locale-metadata', patterns: privateLocaleMetadataPatterns },
  { name: 'current-envelope-metadata', patterns: currentEnvelopeMetadataPatterns },
  { name: 'named-define-collection', patterns: [namedDefineCollectionPattern] },
  { name: 'raw-string-handle-first-helper', patterns: [rawStringHandleFirstHelperPattern] }
]

const selfTest = async () => {
  const fixture = await readFile(new URL('./docs-drift-fixtures/positive-controls.md', import.meta.url), 'utf8')
  const lines = fixture.split('\n')
  const dead = []

  for (const group of patternGroups) {
    for (const pattern of group.patterns) {
      pattern.lastIndex = 0
      if (!lines.some((line) => {
        pattern.lastIndex = 0
        return pattern.test(line)
      })) {
        dead.push(`${group.name}: ${pattern}`)
      }
    }
  }

  if (dead.length > 0) {
    console.error('docs-drift self-test: dead detector pattern(s):')
    for (const item of dead) console.error(`  ${item}`)
    process.exit(1)
  }
}

// Each check returns { name, offenders: string[] }.
const checks = [
  async () => {
    const offenders = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots, ...maintainedFixtureRoots])) {
      offenders.push(...findStalePublicApiLines(file, await readFile(file, 'utf8')))
    }
    return { name: 'current public docs do not teach removed query APIs', offenders }
  },
  async () => {
    const offenders = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots])) {
      offenders.push(...findAdvancedSurfaceLinesOutsideAdvancedDocs(file, await readFile(file, 'utf8')))
    }
    return { name: 'beginner docs do not teach advanced provider cache or agent surfaces', offenders }
  },
  async () => {
    const offenders = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots, ...maintainedFixtureRoots])) {
      offenders.push(...findPrivateLocaleMetadataLines(file, await readFile(file, 'utf8')))
    }
    return { name: 'active docs prefer public localized resolution metadata', offenders }
  },
  async () => {
    const offenders = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots, ...maintainedFixtureRoots])) {
      offenders.push(...findCurrentEnvelopeMetadataLines(file, await readFile(file, 'utf8')))
    }
    return { name: 'active docs and examples do not teach underscore envelope fields as current API', offenders }
  },
  async () => {
    const offenders = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots])) {
      offenders.push(...findUnsupportedPublicOperatorLines(file, await readFile(file, 'utf8')))
    }
    return { name: 'docs and examples do not teach unsupported public query operators', offenders }
  },
  async () => {
    const offenders = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots, ...sourceExampleFiles])) {
      offenders.push(...findNamedDefineCollectionLines(file, await readFile(file, 'utf8')))
    }
    return { name: 'current docs do not teach authored collection names as the default', offenders }
  },
  async () => {
    const offenders = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots])) {
      offenders.push(...findRawStringHandleFirstHelperLines(file, await readFile(file, 'utf8')))
    }
    return { name: 'current docs and examples prefer collection handles for app-facing content helpers', offenders }
  },
  async () => {
    const offenders = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots, ...sourceExampleFiles])) {
      offenders.push(...findUnapprovedFallbackLines(file, await readFile(file, 'utf8')))
    }
    return { name: 'fallback examples stay in fallback-aware docs', offenders }
  },
  async () => {
    const files = await collectTextFiles([...markdownRoots, ...exampleRoots, ...sourceExampleFiles])
    const sources = await Promise.all(files.map(async file => ({ file, source: await readFile(file, 'utf8') })))
    const offenders = sources.flatMap(({ file, source }) =>
      findMissingContentConfigHandleImports(file, source, collectExportedContentConfigHandles(source))
    )
    return { name: 'content.config imports reference exported collection handles shown in docs', offenders }
  },
  async () => {
    const offenders = []
    for (const file of await collectTextFiles(markdownRoots)) {
      offenders.push(...findIncompleteContentConfigSnippetLines(file, await readFile(file, 'utf8')))
    }
    return { name: 'content.config snippets are complete exported configs', offenders }
  },
  async () => {
    const publicSubpaths = await collectPublicPackageSubpaths()
    const offenders = []
    for (const file of await collectTextFiles(exampleImportRoots)) {
      offenders.push(...findNonPublicGinkoImportLines(file, await readFile(file, 'utf8'), publicSubpaths))
    }
    return { name: 'examples import Ginko only through public package subpaths', offenders }
  },
  async () => {
    const offenders = []
    for (const file of await collectTextFiles(exampleImportRoots)) {
      offenders.push(...findNuxtContentImports(file, await readFile(file, 'utf8')))
    }
    return { name: 'examples do not import Nuxt Content directly', offenders }
  },
  async () => {
    const [manifestSource, workspaceManifestSource] = await Promise.all([
      readFile('packages/content/package.json', 'utf8'),
      readFile('package.json', 'utf8')
    ])
    const manifest = JSON.parse(manifestSource)
    const workspaceManifest = JSON.parse(workspaceManifestSource)
    const readme = await readFile('packages/content/README.md', 'utf8')
    const installDoc = await readFile('docs/content/docs/1.get-started/1.quickstart.md', 'utf8')
    const requiredPeers = Object.entries(manifest.peerDependencies)
      .filter(([name]) => !manifest.peerDependenciesMeta?.[name]?.optional)
    const requiredPeerLabels = requiredPeers
      .map(([name, range]) => peerRequirementLabel(name, range))
      .filter(label => Boolean(label))

    const offenders = []
    const nodeRange = manifest.engines?.node
    const nodeRequirement = typeof nodeRange === 'string' ? nodeRequirementLabel(nodeRange) : null
    if (!nodeRequirement) offenders.push(`package engines.node is missing or cannot be rendered: ${nodeRange}`)
    if (workspaceManifest.engines?.node !== nodeRange) {
      offenders.push(`workspace engines.node drifted: expected ${nodeRange}, got ${workspaceManifest.engines?.node}`)
    }
    if (nodeRequirement && !readme.includes(nodeRequirement)) offenders.push(`packages/content/README.md missing runtime requirement: ${nodeRequirement}`)
    if (nodeRequirement && !installDoc.includes(nodeRequirement)) offenders.push(`installation docs missing runtime requirement: ${nodeRequirement}`)
    if (requiredPeerLabels.length !== requiredPeers.length) {
      offenders.push(`required peer ranges cannot all be rendered: ${JSON.stringify(requiredPeers)}`)
    }
    for (const label of requiredPeerLabels) {
      if (!readme.includes(label)) offenders.push(`packages/content/README.md missing peer requirement: ${label}`)
      if (!installDoc.includes(label)) offenders.push(`docs/content/docs/1.get-started/1.quickstart.md missing peer requirement: ${label}`)
    }
    return { name: 'README requirements match required package peer dependency floors', offenders }
  },
  async () => {
    const offenders = await findAdrIndexDriftOffenders()
    return { name: 'ADR frontmatter id/status stay structurally in sync with meta/adr/README.md', offenders }
  },
  async () => {
    const offenders = []
    for (const file of await collectTextFiles(['docs/content/docs'])) {
      offenders.push(...findGenericDiscoveryFooterLines(file, await readFile(file, 'utf8')))
    }
    return { name: 'docs end on useful content instead of generic discovery footers', offenders }
  },
  async () => {
    const offenders = []
    for (const file of await collectTextFiles(['docs/content/docs'])) {
      offenders.push(...findBodyTitleLines(file, await readFile(file, 'utf8')))
    }
    return { name: 'docs use frontmatter titles without duplicate body h1 headings', offenders }
  },
  async () => {
    const offenders = []
    for (const file of await collectTextFiles([
      'docs/content/docs',
      'skills/ginko-content/references',
      'README.md',
      'packages/content/README.md'
    ])) {
      offenders.push(...findAppRelativeContentConfigImports(file, await readFile(file, 'utf8')))
    }
    return { name: 'Nuxt 4 examples import root content.config through the ~~ alias', offenders }
  }
]

const main = async () => {
  await selfTest()
  if (process.argv.includes('--self-test')) {
    console.log('docs-drift self-test: OK')
    return
  }

  const results = await Promise.all(checks.map(check => check()))
  const failed = results.filter(result => result.offenders.length > 0)

  if (failed.length === 0) {
    console.log(`docs-drift: OK (${results.length} checks passed)`)
    return
  }

  console.error('docs-drift: documentation drift detected\n')
  for (const { name, offenders } of failed) {
    console.error(`  ✗ ${name}`)
    for (const offender of offenders) {
      console.error(`      ${offender}`)
    }
  }
  console.error('')
  process.exitCode = 1
}

main().catch((error) => {
  console.error('docs-drift: linter crashed')
  console.error(error)
  process.exitCode = 1
})
