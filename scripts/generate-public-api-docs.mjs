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
  './body-renderer': {
    environment: 'Vue SSR / browser',
    purpose: 'Validated Markdown body renderer with explicit policy and component selection',
    guide: ['/docs/reference/components', 'Components'],
    stability: 'Experimental',
  },
  './navigation': {
    environment: 'Framework-free',
    purpose: 'Navigation-tree traversal and path helpers',
    guide: ['/docs/guides/navigation', 'Navigation'],
  },
  './agent-docs': {
    environment: 'Local Markdown file',
    purpose: 'Documentation snapshot for the installed package version; resolve and read, do not import',
    guide: ['/docs/get-started/quickstart#install-use-a-coding-agent', 'Use a coding agent'],
  },
  './agent': {
    environment: 'Framework-free',
    purpose: 'Agent-readable Markdown serialization and index rendering',
    guide: ['/docs/guides/agent-readable-output', 'Agent-readable output'],
    stability: 'Experimental',
  },
  './agent-registry': {
    environment: 'Build time',
    purpose: 'Agent component-serializer registry definitions',
    guide: ['/docs/guides/agent-readable-output', 'Agent-readable output'],
    stability: 'Experimental',
  },
  './agent-paths': {
    environment: 'Framework-free',
    purpose: 'Canonical agent and raw-content route paths',
    guide: ['/docs/guides/agent-readable-output', 'Agent-readable output'],
    stability: 'Experimental',
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
    stability: 'Experimental',
  },
  './testing/provider-contract': {
    environment: 'Vitest / Node',
    purpose: 'Executable provider conformance suite',
    guide: ['/docs/reference/provider-contract', 'Provider contract'],
    stability: 'Experimental',
  },
  './testing/data-source-contract': {
    environment: 'Vitest / Node',
    purpose: 'Executable data-source and binder conformance suite',
    guide: ['/docs/guides/data-source-adapters#evidence-levels', 'Adapter evidence'],
    stability: 'Experimental',
  },
  './testing/portability-contract': {
    environment: 'Vitest / Node',
    purpose: 'Executable portable-directory conformance suite',
    guide: ['/docs/guides/data-source-adapters#portable-reads-and-writes', 'Portable reads and writes'],
    stability: 'Experimental',
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
  const types = subpath === './agent-docs' ? '—' : typeof target === 'string' ? target : target.types
  const [guidePath, guideLabel] = metadata.guide
  const stability = metadata.stability ?? 'Stable'
  return `| \`${specifier}\` | ${stability} | ${metadata.environment} | ${metadata.purpose} | \`${types}\` | [${guideLabel}](${guidePath}) |`
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

A stable subpath follows semver: a breaking change needs a major version, a
changelog note, and a migration path. An experimental subpath can change in a
minor version; the changelog records each change.

| Import | Stability | Environment | Purpose | Types | Guide |
| --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

## CMS contract exports

\`@lupinum/ginko-content/cms-contract\` is stable and runs without Node, Nuxt,
Nitro, or h3. A test follows its module graph and fails on any such import.
Editors and CMS integrations use these groups:

| Group | Exports |
| --- | --- |
| Parse and serialize | \`parseMdcDocument\`, \`serializeMdcDocument\`, \`projectMdcDocument\`, \`parseMdcBody\`, \`AngleComponentSyntaxError\`, \`MdcSerializationError\` |
| Editing document types | \`MdcDocument\`, \`MdcNode\`, \`MdcElementNode\`, \`MdcCommentNode\`, \`MdcElementProps\`, \`MdcSerializationIssueCode\`, \`ParseMdcDocumentOptions\`, \`SerializeMdcDocumentOptions\`, \`ParseMdcBodyOptions\`, \`ParseMdcBodyResult\` |
| Heading ids | \`slugifyHeading\`, \`createHeadingIdGenerator\`, \`headingSlugText\` |
| Body validation | \`validatePublicMarkdownAst\`, \`validateStoredPortableMarkdownAst\`, \`assertPublicMarkdownAst\`, \`classifyPortableMarkdownElement\` |
| URL and name rules | \`isSafePublicLinkUrl\`, \`isSafePublicMarkdownUrl\`, \`isStoredPortableAssetIdentity\`, \`isValidPortableComponentName\`, \`canonicalizePortableComponentName\` |
| Component policy | \`assertPortableComponentPolicy\`, \`assertPortableComponentPolicyV2\`, \`PortableComponentPolicy\`, \`PortableComponentPolicyV1\`, \`PortableComponentPolicyV2\` |
| Limits and media | \`PORTABLE_CONTENT_LIMITS\`, \`CONTENT_MANAGED_MEDIA_TYPES\`, \`ContentManagedMediaType\` |
| Resolved contract | \`buildResolvedContentContract\`, \`assertResolvedContentContract\`, \`assertResolvedContentContractV1\`, \`assertResolvedContentContractV2\`, \`RESOLVED_CONTENT_CONTRACT_VERSION_V1\`, \`RESOLVED_CONTENT_CONTRACT_VERSION_V2\` |

\`assertPortableComponentPolicy\` validates the current policy version, 2.
\`assertPortableComponentPolicyV2\` is the same function under a
version-pinned name. \`RESOLVED_CONTENT_CONTRACT_VERSION\` equals
\`RESOLVED_CONTENT_CONTRACT_VERSION_V1\`; prefer the explicit name.

\`isSafePublicLinkUrl\` accepts \`https:\`, \`http:\`, \`mailto:\`, \`tel:\`,
same-site paths, fragments, and \`$\` Content references. Media sources accept
only \`https:\` and same-site paths. Use the same functions in editor fields and
server validation.
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
