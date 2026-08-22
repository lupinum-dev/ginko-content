import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifestPath = resolve(root, 'packages/content/package.json')
const outputPath = resolve(root, 'docs/content/docs/5.reference/11.package-exports.md')

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

// package.json owns the export paths and declaration targets. This map owns
// only the human meaning that a package manifest cannot express.
const exportMetadata = {
  '.': {
    environment: 'Nuxt module setup',
    purpose: 'Module registration and content configuration helpers',
    guide: ['/docs/get-started/quickstart', 'Quickstart'],
  },
  './config': {
    environment: 'Build time',
    purpose: 'Collection, schema, and source configuration',
    guide: ['/docs/reference/content-config', 'Content config'],
  },
  './server': {
    environment: 'Nitro / H3',
    purpose: 'Server queries, sitemap reads, and cache helpers',
    guide: ['/docs/reference/server-api', 'Server API'],
  },
  './provider': {
    environment: 'Nitro / H3',
    purpose: 'Runtime content-provider contract and binder',
    guide: ['/docs/guides/providers', 'Providers'],
  },
  './data-source': {
    environment: 'Framework-free',
    purpose: 'Bounded backend adapter contract and stable errors',
    guide: ['/docs/guides/data-source-adapters', 'Data-source adapters'],
  },
  './client': {
    environment: 'Vue SSR / browser',
    purpose: 'Client query functions, page/search composables, and derivations',
    guide: ['/docs/reference/query-api', 'Query API'],
  },
  './navigation': {
    environment: 'Framework-free',
    purpose: 'Navigation-tree traversal and path helpers',
    guide: ['/docs/guides/navigation', 'Navigation'],
  },
  './agent': {
    environment: 'Framework-free',
    purpose: 'Agent-readable Markdown serialization and index rendering',
    guide: ['/docs/guides/agent-readable-output', 'Agent-readable output'],
  },
  './agent-registry': {
    environment: 'Build time',
    purpose: 'Agent component-serializer registry definitions',
    guide: ['/docs/guides/agent-readable-output', 'Agent-readable output'],
  },
  './agent-paths': {
    environment: 'Framework-free',
    purpose: 'Canonical agent and raw-content route paths',
    guide: ['/docs/guides/agent-readable-output', 'Agent-readable output'],
  },
  './cms-contract': {
    environment: 'Framework-free',
    purpose: 'Resolved CMS contract, schema inspection, MDC, hashing, and safety',
    guide: ['/docs/guides/data-source-adapters', 'Data-source adapters'],
  },
  './cms-contract/node': {
    environment: 'Node',
    purpose: 'Read the canonical resolved Content contract artifact',
    guide: ['/docs/guides/data-source-adapters', 'Data-source adapters'],
  },
  './portability': {
    environment: 'Framework-free',
    purpose: 'Portable document, manifest, asset, and validation codecs',
    guide: ['/docs/guides/data-source-adapters#portable-reads-and-writes', 'Portable reads and writes'],
  },
  './portability/node': {
    environment: 'Node',
    purpose: 'Bounded portable-directory filesystem I/O',
    guide: ['/docs/guides/data-source-adapters#portable-reads-and-writes', 'Portable reads and writes'],
  },
  './testing/provider-fixture': {
    environment: 'Vitest / Node',
    purpose: 'Reusable provider-contract fixture data',
    guide: ['/docs/reference/provider-contract', 'Provider contract'],
  },
  './testing/provider-contract': {
    environment: 'Vitest / Node',
    purpose: 'Executable provider conformance suite',
    guide: ['/docs/reference/provider-contract', 'Provider contract'],
  },
  './testing/data-source-contract': {
    environment: 'Vitest / Node',
    purpose: 'Executable data-source and binder conformance suite',
    guide: ['/docs/guides/data-source-adapters#evidence-levels', 'Adapter evidence'],
  },
  './testing/portability-contract': {
    environment: 'Vitest / Node',
    purpose: 'Executable portable-directory conformance suite',
    guide: ['/docs/guides/data-source-adapters#portable-reads-and-writes', 'Portable reads and writes'],
  },
  './transformers': {
    environment: 'Build time',
    purpose: 'Custom content-transformer definition helper',
    guide: ['/docs/reference/module-options', 'Module options'],
  },
}

const exportSubpaths = Object.keys(manifest.exports)
const missingMetadata = exportSubpaths.filter(subpath => !(subpath in exportMetadata))
const staleMetadata = Object.keys(exportMetadata).filter(subpath => !exportSubpaths.includes(subpath))
if (missingMetadata.length || staleMetadata.length) {
  throw new Error([
    missingMetadata.length ? `Unclassified package exports: ${missingMetadata.join(', ')}` : '',
    staleMetadata.length ? `Metadata without package exports: ${staleMetadata.join(', ')}` : '',
  ].filter(Boolean).join('\n'))
}

const rows = exportSubpaths.map((subpath) => {
  const target = manifest.exports[subpath]
  const metadata = exportMetadata[subpath]
  const specifier = subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`
  const types = typeof target === 'string' ? target : target.types
  const [guidePath, guideLabel] = metadata.guide
  return `| \`${specifier}\` | ${metadata.environment} | ${metadata.purpose} | \`${types}\` | [${guideLabel}](${guidePath}) |`
})

const generated = `---
title: Package exports
description: Supported package import paths, execution environments, and focused guides.
---

This page is generated by \`pnpm api-docs:generate\`; do not edit it directly.
\`packages/content/package.json\` is the source of truth for import paths and
declaration targets. The generator requires a purpose, execution environment,
and focused guide for every manifest export, so an unclassified new subpath
fails \`pnpm api-docs:check\`.

Public TypeScript declarations at each subpath define its complete symbol-level
API. For example, the data-source declaration exposes
\`createContentDataSourceError\` and \`ContentDataSourceErrorCode\` as well as
the adapter interfaces and limits. See the
[data-source adapter guide](/docs/guides/data-source-adapters) for their use.

## Package subpaths

| Import | Environment | Purpose | Types | Guide |
| --- | --- | --- | --- | --- |
${rows.join('\n')}
`

if (process.argv.includes('--check')) {
  const current = await readFile(outputPath, 'utf8').catch(() => '')
  if (current !== generated) {
    console.error('Generated package export documentation is stale. Run pnpm api-docs:generate.')
    process.exit(1)
  }
} else {
  await writeFile(outputPath, generated)
}
