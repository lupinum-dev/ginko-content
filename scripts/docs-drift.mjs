#!/usr/bin/env node
// Documentation-drift linter.
//
// Scans shipped docs and examples for facts with a concrete source of truth:
// query operators, package imports, config shape, dependency floors, and ADR
// structure. It runs in CI through `verify` and `release:verify`.
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

const sourceExampleFiles = [
  'packages/content/src/types/config.ts'
]

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

const normalizePath = file => file.split('\\').join('/')

// ADRs quote rejected and superseded APIs by design, so currency checks apply
// to current documentation rather than decision history.
const isAdrDoc = file => normalizePath(file).startsWith('meta/adr/')

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

// Each check returns { name, offenders: string[] }.
const checks = [
  async () => {
    const offenders = []
    for (const file of await collectTextFiles([...markdownRoots, ...exampleRoots])) {
      offenders.push(...findUnsupportedPublicOperatorLines(file, await readFile(file, 'utf8')))
    }
    return { name: 'docs and examples do not teach unsupported public query operators', offenders }
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
