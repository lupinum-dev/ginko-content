import { lstat } from 'node:fs/promises'
import { resolve, join } from 'node:path'

import defu from 'defu'
import { globby } from 'globby'
import jiti from 'jiti'

import { buildResolvedContentContract } from '../cms-contract/build.js'
import { verifyPublicImageBytes } from '../cms-contract/asset-bytes.js'
import { canonicalJsonBytes, hashCanonicalJson, sha256Hex, type JsonValue } from '../cms-contract/hash.js'
import { PORTABLE_CONTENT_LIMITS } from '../cms-contract/limits.js'
import type { ResolvedContentCollectionV1, ResolvedContentContractV1, ResolvedContentFieldV1 } from '../cms-contract/types.js'
import { buildContentGraph } from '../core/content/graph.js'
import { expandDataLocaleVariants } from '../core/content/locale.js'
import { resolveCollections } from '../core/content/collection.js'
import { isNavigationFile } from '../core/content/structural.js'
import { resolveLocalePolicy, type ResolvedLocalePolicy } from '../features/localization/locale-policy.js'
import { resolveCollectionI18nConfig } from '../features/localization/config.js'
import { buildCanonicalNavigation } from '../features/navigation/build.js'
import type { CanonicalNavigationItem } from '../features/navigation/canonical.js'
import { resolveSitemapCollections } from '../features/sitemap/counts.js'
import { parseComark } from '../core/markdown/parse-comark.js'
import csvParser from '../parsers/csv.js'
import jsonParser from '../parsers/json.js'
import pathMeta from '../parsers/path-meta.js'
import { stripReservedContentKeys } from '../parsers/reserved.js'
import yamlParser from '../parsers/yaml.js'
import { validatePortableDocument } from '../portability/documents.js'
import {
  assertPortableAssetReference,
  collectPortableAssetReferences,
  collectPortableMdcAssetReferences,
} from '../portability/assets.js'
import { GinkoBoundaryError, type PortabilityErrorCode, type PortabilityOperation } from '../portability/errors.js'
import { validatePortableReferences } from '../portability/references.js'
import type { PortableAssetBlobV1, PortableDocumentV1, PortableManifestV1 } from '../portability/model.js'
import type { ContentCollectionConfig, ContentConfig } from '../types/config.js'
import type { ParsedContent } from '../types/content.js'
import type { ModuleOptions } from '../types/module.js'
import { validateCollectionDocument, validateContentGraph, validateDocumentJsonPurity } from '../storage/validation.js'
import { readResolvedContentContract } from '../cms-contract-node/artifact.js'
import { readStableRegularFile, StableFileError } from '../cms-contract-node/stable-file.js'
import { writePortableDirectory, type PortableAssetWriteInput } from './write-directory.js'
import { readPortableDirectory } from './read-directory.js'

const CONFIG_NAMES = ['content.config.ts', 'content.config.mts', 'content.config.js', 'content.config.mjs', 'content.config.cjs'] as const
const NUXT_CONFIG_NAMES = ['nuxt.config.ts', 'nuxt.config.mts', 'nuxt.config.js', 'nuxt.config.mjs'] as const
const SOURCE_EXTENSIONS = new Set(['md', 'json', 'json5', 'yml', 'yaml', 'csv'])
const filesystemExportDefaults = {
  i18n: true,
  sitemap: true,
  search: false,
  navigation: { fields: [] },
  transformers: [],
  yaml: {},
  csv: { delimiter: ',', json: true },
  respectPathCase: false,
} satisfies Partial<ModuleOptions>
export interface FilesystemPortabilityDiagnostic {
  severity: 'error' | 'warning'
  code: PortabilityErrorCode
  operation: PortabilityOperation
  collection: string | null
  file: string | null
  field: string | null
  message: string
  resolution: string
}

export interface FilesystemPortabilityEvidence {
  inputHash: string
  contractSha256: string
  packageVersion: string
  files: Array<{ file: string; bytes: number; sha256: string }>
}

export interface FilesystemPortabilityAssessment {
  ok: boolean
  rootDir: string
  contract: ResolvedContentContractV1 | null
  documents: PortableDocumentV1[]
  assets: PortableAssetWriteInput[]
  diagnostics: FilesystemPortabilityDiagnostic[]
  evidence: FilesystemPortabilityEvidence | null
  summary: {
    documents: number
    assets: number
    collections: string[]
    locales: string[]
  }
}

export interface FilesystemPortabilityExportResult {
  directory: string
  inputHash: string
  contractSha256: string
  manifestSha256: string
  manifest: PortableManifestV1
  documents: number
  assets: number
  collections: string[]
  locales: string[]
}

export class FilesystemPortabilityAssessmentError extends GinkoBoundaryError {
  constructor(readonly assessment: FilesystemPortabilityAssessment) {
    super({
      operation: 'directory.write',
      code: 'DOCUMENT_INVALID',
      message: `Filesystem content is not portable (${assessment.diagnostics.filter(item => item.severity === 'error').length} error(s)).`,
      details: { errors: assessment.diagnostics.filter(item => item.severity === 'error').length },
    })
  }
}

export async function assessFilesystemPortability(
  options: { rootDir: string },
): Promise<FilesystemPortabilityAssessment> {
  const rootDir = resolve(options.rootDir)
  const diagnostics: FilesystemPortabilityDiagnostic[] = []
  let contract: ResolvedContentContractV1 | null = null
  let contractSha256 = ''
  let packageVersion = ''
  let collections: Record<string, ContentCollectionConfig> = {}
  let localePolicy: ResolvedLocalePolicy | null = null
  let moduleOptions = filesystemExportDefaults as unknown as ModuleOptions

  try {
    const loaded = await loadProjectConfig(rootDir)
    collections = loaded.collections
    localePolicy = loaded.localePolicy
    moduleOptions = loaded.moduleOptions
    packageVersion = loaded.packageVersion
    const artifact = await readResolvedContentContract({ root: rootDir })
    contract = artifact.contract
    contractSha256 = artifact.sha256
    const rebuilt = buildResolvedContentContract(
      { collections },
      {
        defaultLocale: localePolicy.defaultLocale,
        locales: [...localePolicy.locales],
        localeFallbacks: Object.fromEntries(Object.entries(localePolicy.fallback).map(([key, value]) => [key, [...value]])),
        translatedSlugs: localePolicy.translatedSlugs,
        componentPolicy: moduleOptions.componentPolicy,
      },
    )
    const rebuiltHash = await hashCanonicalJson(rebuilt as unknown as JsonValue)
    if (rebuiltHash !== artifact.sha256) {
      diagnostic(diagnostics, 'CONTRACT_HASH_MISMATCH', 'portability.hash', null, '.ginko/content-contract.json', null,
        'The resolved Content contract is stale for the current configuration.',
        'Run the app\'s Nuxt prepare or generate command, then assess again.')
    }
    if (loaded.provider !== 'filesystem') {
      diagnostic(diagnostics, 'CONTRACT_INVALID', 'portability.hash', null, 'content.config', 'provider',
        `The configured provider is "${loaded.provider}"; this boundary exports filesystem content only.`,
        'Switch to the filesystem source before export, or use the provider-owned export path.')
    }
    if (moduleOptions.transformers?.length) {
      diagnostic(diagnostics, 'DOCUMENT_INVALID', 'portability.parse', null, 'nuxt.config', 'content.transformers',
        'Custom filesystem transformers cannot be reproduced by the portable source boundary.',
        'Remove the transformer dependency or define a versioned portable representation for its output.')
    }
  } catch (error) {
    diagnostic(diagnostics, boundaryCode(error, 'CONTRACT_INVALID'), 'portability.hash', null, null, null,
      message(error), 'Fix the project configuration and regenerate its resolved Content contract.')
  }

  if (!contract || !localePolicy) return emptyAssessment(rootDir, diagnostics)

  const sourceRoot = join(rootDir, 'content')
  const sourceFiles: Array<{ file: string; bytes: Uint8Array; sha256: string }> = []
  try {
    const paths = (await globby('**/*', { cwd: sourceRoot, onlyFiles: true, dot: true, followSymbolicLinks: false })).sort()
    if (paths.length > PORTABLE_CONTENT_LIMITS.documents + 1_000) {
      diagnostic(diagnostics, 'LIMIT_EXCEEDED', 'portability.parse', null, 'content', null,
        'The filesystem source exceeds the bounded file count.', 'Reduce the source set or split the migration.')
    } else {
      for (const file of paths) {
        const extension = file.split('.').pop()?.toLowerCase() ?? ''
        if (!SOURCE_EXTENSIONS.has(extension)) continue
        try {
          const path = join(sourceRoot, ...file.split('/'))
          const before = await lstat(path)
          const bytes = await readStableRegularFile(path, before, PORTABLE_CONTENT_LIMITS.documentBytes)
          sourceFiles.push({ file, bytes, sha256: await sha256Hex(bytes) })
        } catch (error) {
          diagnostic(diagnostics, error instanceof StableFileError && error.reason === 'limit' ? 'LIMIT_EXCEEDED' : 'PATH_INVALID', 'portability.parse', null, `content/${file}`, null,
            'The source is not a stable, bounded regular file.', 'Replace symlinks and retry after source writes finish.')
        }
      }
    }
  } catch (error) {
    diagnostic(diagnostics, 'PATH_INVALID', 'portability.parse', null, 'content', null, message(error), 'Ensure the content directory exists and is readable.')
  }

  const parsed: ParsedContent[] = []
  const rawById = new Map<string, string>()
  for (const source of sourceFiles) {
    const matches = resolveCollections(source.file, collections, [...contract.locales])
    const navigation = /(?:^|\/)\.navigation\.ya?ml$/u.test(source.file)
    if (!navigation && matches.length === 0) {
      diagnostic(diagnostics, 'DOCUMENT_INVALID', 'portability.parse', null, `content/${source.file}`, null,
        'The source file does not match a configured collection.', 'Add it to one collection source or exclude/remove it intentionally.')
      continue
    }
    if (matches.length > 1) {
      diagnostic(diagnostics, 'IDENTITY_CONFLICT', 'portability.parse', null, `content/${source.file}`, null,
        `The source file matches multiple collections: ${matches.join(', ')}.`, 'Make collection source globs unambiguous.')
      continue
    }
    try {
      const id = `content:${source.file}`
      const value = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes)
      rawById.set(id, value)
      const document = await parseFilesystemSource(id, value, {
        yaml: moduleOptions.yaml,
        csv: moduleOptions.csv,
        markdown: { plugins: [], tags: {}, anchorLinks: { depth: 4, exclude: [1] } },
        pathMeta: {
          locales: [...contract.locales],
          defaultLocale: contract.defaultLocale,
          translatedSlugs: localePolicy.translatedSlugs,
          respectPathCase: moduleOptions.respectPathCase,
          collections,
          localePolicy: localePolicy.collections,
          collectionResolver: (file: string) => resolveCollections(file, collections, [...contract!.locales])[0],
        },
      })
      const matched = document.collection ? collections[document.collection] : undefined
      const variants = expandDataLocaleVariants(document, matched?.i18n && matched.i18n !== true ? matched.i18n : undefined)
      for (const variant of variants) {
        const schema = validateCollectionDocument(variant, collections)
        if (!schema.ok) throw schema.error
        const pure = validateDocumentJsonPurity(schema.value)
        if (!pure.ok) throw pure.error
        parsed.push(pure.value)
      }
    } catch (error) {
      diagnostic(diagnostics, boundaryCode(error, 'DOCUMENT_INVALID'), 'portability.parse', matches[0] ?? null, `content/${source.file}`, fieldFrom(error),
        message(error), 'Fix the source document so it passes the configured parser and schema.')
    }
  }

  const graph = buildContentGraph(parsed, {
    locales: [...contract.locales],
    defaultLocale: contract.defaultLocale,
  })
  const graphValidation = validateContentGraph(parsed, {
    collections,
    locales: [...contract.locales],
    translatedSlugs: localePolicy.translatedSlugs,
    localePolicy,
  })
  if (!graphValidation.ok) {
    const code = graphValidation.error.code === 'INVALID_REF_VALUE' || graphValidation.error.code === 'SCHEMA_VALIDATION_FAILED'
      ? 'DOCUMENT_INVALID'
      : 'IDENTITY_CONFLICT'
    diagnostic(diagnostics, code, 'portability.validateReferences', null, fieldFile(graphValidation.error), fieldFrom(graphValidation.error),
      graphValidation.error.message, 'Resolve the identity, locale, route, or reference conflict in source content.')
  }

  const navigationFields = moduleOptions.navigation === false ? [] : moduleOptions.navigation?.fields ?? []
  const navigationByVariant = buildNavigationMetadata(parsed, collections, contract, navigationFields)
  const sitemapCollections = new Set(resolveSitemapCollections(collections, moduleOptions.sitemap === false ? false : normalizeSitemap(moduleOptions.sitemap)))
  const documents: PortableDocumentV1[] = []
  for (const document of parsed) {
    if (isFilesystemNavigationFile(document)) continue
    if (document.partial) {
      diagnostic(diagnostics, 'DOCUMENT_INVALID', 'portability.parse', document.collection ?? null, fieldFile(document), null,
        'Portable V1 cannot represent a standalone partial document.', 'Inline the partial, exclude it from the migration, or define a versioned portable contract change.')
      continue
    }
    if (document.draft) {
      diagnostic(diagnostics, 'DOCUMENT_INVALID', 'portability.parse', document.collection ?? null, fieldFile(document), 'draft',
        'Portable V1 does not encode source draft state.', 'Publish or remove the draft, or define a versioned portable contract change before migration.')
      continue
    }
    const collectionId = document.collection
    const canonicalKey = document.canonicalKey
    const locale = document.locale
    if (!collectionId || !canonicalKey || !locale || !contract.collections[collectionId]) {
      diagnostic(diagnostics, 'DOCUMENT_INVALID', 'portability.parse', collectionId ?? null, fieldFile(document), null,
        'The parsed document lacks a collection, canonical key, or locale.', 'Make the source match one configured collection and locale.')
      continue
    }
    try {
      const collection = contract.collections[collectionId]!
      const fields = await portableFields(document, collection, graph, diagnostics)
      const routeBacked = collection.kind === 'page' && collection.routing.mode === 'route'
      const navigationKey = variantKey(collectionId, canonicalKey, locale)
      const nav = navigationByVariant.get(navigationKey)
      if (nav) {
        for (const field of collection.fields.filter(item => item.role !== 'body')) {
          if (!(field.key in nav)) continue
          ;(field.localized ? fields.localized : fields.shared)[field.key] = nav[field.key] as JsonValue
        }
      }
      const body = document.type === 'markdown'
        ? { kind: 'mdc' as const, source: markdownBody(requiredRawSource(rawById, document.id)) }
        : null
      const portable: PortableDocumentV1 = {
        format: 'ginko-content-document',
        version: 1,
        collection: collectionId,
        canonicalKey,
        locale,
        slug: routeBacked ? routeSlug(document, collection) : '',
        parentCanonicalKey: routeBacked && collection.structure === 'tree' ? treeParent(canonicalKey) : null,
        order: routeBacked && collection.structure === 'tree' ? treeOrder(canonicalKey) : null,
        shared: fields.shared,
        localized: fields.localized,
        body,
        visibility: routeBacked ? {
          navigation: moduleOptions.navigation !== false && Boolean(nav),
          search: searchVisible(moduleOptions.search, collectionId),
          sitemap: sitemapCollections.has(collectionId) && document.sitemap !== false,
        } : { navigation: false, search: false, sitemap: false },
      }
      documents.push(validatePortableDocument(portable, contract))
    } catch (error) {
      diagnostic(diagnostics, boundaryCode(error, 'DOCUMENT_INVALID'), 'portability.parse', collectionId, fieldFile(document), fieldFrom(error),
        message(error), 'Align the source value and collection contract; no value was discarded.')
    }
  }

  try {
    validatePortableReferences(documents, contract)
  } catch (error) {
    diagnostic(diagnostics, boundaryCode(error, 'REFERENCE_MISSING'), 'portability.validateReferences', null, null, null,
      message(error), 'Add the referenced entry or correct the source reference.')
  }
  const sharedByIdentity = new Map<string, string>()
  for (const document of documents) {
    const identity = `${document.collection}\0${document.canonicalKey}`
    const hash = await hashCanonicalJson(document.shared as unknown as JsonValue)
    const previous = sharedByIdentity.get(identity)
    if (previous && previous !== hash) {
      diagnostic(diagnostics, 'SHARED_FIELD_DIVERGENCE', 'directory.verify', document.collection, null, null,
        `Shared fields differ between locale variants of "${document.canonicalKey}".`,
        'Move translated values to localized fields or make the shared source values identical.')
    }
    sharedByIdentity.set(identity, hash)
  }

  documents.sort((left, right) => variantKey(left.collection, left.canonicalKey, left.locale).localeCompare(variantKey(right.collection, right.canonicalKey, right.locale)))
  const assets = await materializeManagedAssets(rootDir, documents, contract, diagnostics)
  const evidenceFiles = sourceFiles.map(({ file, bytes, sha256 }) => ({ file: `content/${file}`, bytes: bytes.byteLength, sha256 }))
  evidenceFiles.push(...assets.map(asset => ({ file: asset.file, bytes: asset.bytes, sha256: asset.sha256 })))
  for (const name of [...CONFIG_NAMES, ...NUXT_CONFIG_NAMES, '.ginko/content-contract.json', 'package.json']) {
    try {
      const path = join(rootDir, ...name.split('/'))
      const before = await lstat(path)
      const bytes = await readStableRegularFile(path, before, PORTABLE_CONTENT_LIMITS.contractBytes)
      evidenceFiles.push({ file: name, bytes: bytes.byteLength, sha256: await sha256Hex(bytes) })
    } catch { /* optional config names are represented by the loaded result */ }
  }
  evidenceFiles.sort((left, right) => left.file.localeCompare(right.file))
  const inputHash = await hashCanonicalJson({ contractSha256, packageVersion, files: evidenceFiles } as unknown as JsonValue)
  const summary = summarize(documents, assets)
  return {
    ok: !diagnostics.some(item => item.severity === 'error'),
    rootDir,
    contract,
    documents,
    assets,
    diagnostics,
    evidence: { inputHash, contractSha256, packageVersion, files: evidenceFiles },
    summary,
  }
}

async function parseFilesystemSource(
  id: string,
  source: string,
  options: {
    yaml?: unknown
    csv?: unknown
    markdown: unknown
    pathMeta: Record<string, unknown>
  },
): Promise<ParsedContent> {
  const extension = id.slice(id.lastIndexOf('.')).toLowerCase()
  let parsed: ParsedContent
  if (extension === '.md') {
    const tree = await parseComark(source)
    const frontmatter = stripReservedContentKeys(tree.frontmatter as Record<string, unknown>, id)
    parsed = {
      ...frontmatter,
      description: typeof frontmatter.description === 'string' ? frontmatter.description : '',
      id,
      type: 'markdown',
      body: { type: 'root', children: [] },
    } as ParsedContent
  } else {
    const parser = extension === '.json' || extension === '.json5'
      ? jsonParser
      : extension === '.yml' || extension === '.yaml'
        ? yamlParser
        : extension === '.csv'
          ? csvParser
          : null
    if (!parser?.parse) throw new TypeError(`Unsupported filesystem extension "${extension}".`)
    parsed = await parser.parse(id, source, extension === '.csv' ? options.csv : options.yaml)
  }
  if (!pathMeta.transform) throw new TypeError('The canonical path transformer is unavailable.')
  return await pathMeta.transform(parsed, options.pathMeta)
}

export async function exportFilesystemToPortableDirectory(options: {
  rootDir: string
  destination: string
  expectedInputHash?: string
}): Promise<FilesystemPortabilityExportResult> {
  const assessment = await assessFilesystemPortability({ rootDir: options.rootDir })
  if (!assessment.ok || !assessment.contract || !assessment.evidence) throw new FilesystemPortabilityAssessmentError(assessment)
  if (options.expectedInputHash && options.expectedInputHash !== assessment.evidence.inputHash) {
    throw new GinkoBoundaryError({
      operation: 'directory.write', code: 'CONTRACT_HASH_MISMATCH',
      message: 'Filesystem content changed after assessment; export was refused.',
      details: { expectedInputHash: options.expectedInputHash, actualInputHash: assessment.evidence.inputHash },
    })
  }
  const destination = resolve(options.rootDir, options.destination)
  await writePortableDirectory(destination, { contract: assessment.contract, documents: assessment.documents, assets: assessment.assets })
  const bundle = await readPortableDirectory(destination)
  return {
    directory: destination,
    inputHash: assessment.evidence.inputHash,
    contractSha256: assessment.evidence.contractSha256,
    manifestSha256: await hashCanonicalJson(bundle.manifest as unknown as JsonValue),
    manifest: bundle.manifest,
    ...assessment.summary,
  }
}

async function loadProjectConfig(rootDir: string) {
  const configPath = await firstExisting(rootDir, CONFIG_NAMES)
  const nuxtPath = await firstExisting(rootDir, NUXT_CONFIG_NAMES)
  if (!configPath || !nuxtPath) throw new TypeError('A content.config.* and nuxt.config.* are required.')
  const importer = jiti(rootDir, { interopDefault: true, moduleCache: false })
  const contentConfig = unwrap(await importer.import(configPath)) as ContentConfig
  const nuxtConfig = unwrap(await importer.import(nuxtPath)) as Record<string, unknown>
  if (!contentConfig.collections || !Object.keys(contentConfig.collections).length) throw new TypeError('content.config.* must declare collections.')
  const moduleOptions = defu((nuxtConfig.content ?? {}) as ModuleOptions, filesystemExportDefaults) as ModuleOptions
  const modules = Array.isArray(nuxtConfig.modules) ? nuxtConfig.modules : []
  const i18n = (nuxtConfig.i18n ?? {}) as { locales?: Array<string | { code?: string }>; defaultLocale?: string; strategy?: string }
  const moduleI18n = moduleOptions.i18n === false || moduleOptions.i18n === true ? {} : moduleOptions.i18n ?? {}
  const localePolicy = resolveLocalePolicy({
    nuxtI18n: {
      installed: modules.some(item => (Array.isArray(item) ? item[0] : item) === '@nuxtjs/i18n'),
      locales: i18n.locales?.map(item => typeof item === 'string' ? item : item.code).filter((item): item is string => Boolean(item)),
      defaultLocale: i18n.defaultLocale,
      strategy: i18n.strategy,
    },
    content: {
      locales: moduleI18n.locales,
      defaultLocale: moduleI18n.defaultLocale,
      fallback: moduleI18n.fallback,
      translatedSlugs: moduleI18n.translatedSlugs,
    },
    collections: Object.entries(contentConfig.collections).map(([name, collection]) => ({
      name,
      localized: Boolean(collection.i18n),
      ...(collection.i18n && collection.i18n !== true ? { locales: collection.i18n.locales, defaultLocale: collection.i18n.defaultLocale } : {}),
      route: collection.route,
    })),
  })
  const collections = Object.fromEntries(Object.entries(contentConfig.collections).map(([name, collection]) => [name, {
    ...collection,
    i18n: collection.i18n === false ? false : resolveCollectionI18nConfig(collection, { defaultLocale: localePolicy.defaultLocale, locales: [...localePolicy.locales] }),
  }]))
  let packageVersion = 'unknown'
  try {
    const appManifest = unwrap(await importer.import(join(rootDir, 'node_modules/@lupinum/ginko-content/package.json'))) as { version?: string }
    packageVersion = appManifest.version ?? packageVersion
  } catch { /* package manifests are not addressable in every supported dependency layout */ }
  return { collections, localePolicy, moduleOptions, provider: contentConfig.provider ?? 'filesystem', packageVersion }
}

function buildNavigationMetadata(
  documents: ParsedContent[],
  collections: Record<string, ContentCollectionConfig>,
  contract: ResolvedContentContractV1,
  fields: string[],
) {
  const result = new Map<string, Record<string, unknown>>()
  for (const [collection, config] of Object.entries(collections)) {
    const pages = documents.filter(item => item.collection === collection && !item.partial && !isFilesystemNavigationFile(item))
    const locales = new Set(pages.map(item => item.locale).filter((item): item is string => Boolean(item)))
    for (const locale of locales) {
      const variants = pages.filter(item => item.locale === locale)
      const configs: Record<string, ParsedContent> = {}
      const overrides = new Map<string, Record<string, unknown>>()
      for (const navigation of documents.filter(item => isFilesystemNavigationFile(item) && item.locale === locale)) {
        const directory = sourceDirectory(navigation.file?.path)
        const indexPage = variants.find(item => sourceDirectory(item.file?.path) === directory && /(?:^|\/)\d*\.?index\.[^.]+$/u.test(item.file?.path ?? ''))
        if (indexPage?.path && indexPage.canonicalKey) {
          configs[indexPage.path] = { ...navigation, path: indexPage.path }
          overrides.set(indexPage.canonicalKey, navigation)
        }
      }
      const portableFields = contract.collections[collection]?.fields.map(field => field.key) ?? []
      for (const node of flattenNavigation(buildCanonicalNavigation(variants, configs, [...new Set([...fields, ...portableFields])]))) {
        if (!node.canonicalKey) continue
        const configured = overrides.get(node.canonicalKey)
        result.set(variantKey(collection, node.canonicalKey, locale), configured
          ? Object.fromEntries(portableFields.filter(key => key in configured).map(key => [key, configured[key]]))
          : {})
      }
    }
    void config
  }
  return result
}

function flattenNavigation(items: CanonicalNavigationItem[]): CanonicalNavigationItem[] {
  return items.flatMap(item => [item, ...flattenNavigation(item.children ?? [])])
}

function isFilesystemNavigationFile(document: ParsedContent): boolean {
  return isNavigationFile(document) || /(?:^|\/)\.navigation\.ya?ml$/u.test(document.file?.path ?? '')
}

function sourceDirectory(file: string | undefined): string {
  if (!file) return ''
  const separator = file.lastIndexOf('/')
  return separator < 0 ? '' : file.slice(0, separator)
}

async function portableFields(document: ParsedContent, collection: ResolvedContentCollectionV1, graph: ReturnType<typeof buildContentGraph>, diagnostics: FilesystemPortabilityDiagnostic[]) {
  const shared: Record<string, JsonValue> = {}
  const localized: Record<string, JsonValue> = {}
  for (const field of collection.fields) {
    if (field.role === 'body' || !(field.key in document)) continue
    const value = await portableFieldValue(field, document[field.key], graph, document, diagnostics)
    ;(field.localized ? localized : shared)[field.key] = value
  }
  return { shared, localized }
}

async function portableFieldValue(field: ResolvedContentFieldV1, value: unknown, graph: ReturnType<typeof buildContentGraph>, document: ParsedContent, diagnostics: FilesystemPortabilityDiagnostic[]): Promise<JsonValue> {
  if (field.type === 'relation' || field.type === 'relations') {
    const values = field.type === 'relations' ? value as unknown[] : [value]
    const refs = values.map(item => {
      if (typeof item !== 'string') throw new TypeError(`Field "${field.key}" must contain source reference strings.`)
      const canonicalKey = graph.referenceTargetsByCollection[field.relation!.collection]?.get(item)
      if (!canonicalKey) throw new TypeError(`Field "${field.key}" contains unresolved reference "${item}".`)
      return { collection: field.relation!.collection, canonicalKey }
    })
    return (field.type === 'relations' ? refs : refs[0]) as JsonValue
  }
  if (field.type === 'image' || field.type === 'images') {
    const values = field.type === 'images' ? value as unknown[] : [value]
    const refs = values.map(item => {
      if (typeof item === 'string' && item.startsWith('https://')) return { kind: 'external', url: item }
      if (item && typeof item === 'object') return assertPortableAssetReference(item)
      throw new TypeError(`Field "${field.key}" uses a site-owned or unsupported asset; portable managed assets require explicit /ginko-assets identity and verified bytes.`)
    })
    return (field.type === 'images' ? refs : refs[0]) as JsonValue
  }
  if ((field.type === 'object' || field.type === 'array' || field.type === 'blocks') && field.fields) {
    const convert = async (input: unknown): Promise<JsonValue> => {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return input as JsonValue
      const output: Record<string, JsonValue> = {}
      for (const child of field.fields!) if (child.key in input) output[child.key] = await portableFieldValue(child, (input as Record<string, unknown>)[child.key], graph, document, diagnostics)
      return output
    }
    return Array.isArray(value) ? await Promise.all(value.map(convert)) : await convert(value)
  }
  canonicalJsonBytes(value as JsonValue)
  void document; void diagnostics
  return value as JsonValue
}

async function materializeManagedAssets(
  rootDir: string,
  documents: PortableDocumentV1[],
  contract: ResolvedContentContractV1,
  diagnostics: FilesystemPortabilityDiagnostic[],
): Promise<PortableAssetWriteInput[]> {
  const referenced = new Map<string, { sha256: string; mediaType: PortableAssetBlobV1['mediaType']; collection: string }>()
  for (const document of documents) {
    const collection = contract.collections[document.collection]
    if (!collection) continue
    try {
      for (const reference of collectPortableAssetReferences(collection.fields, { ...document.shared, ...document.localized })) {
        if (reference.kind === 'local') referenced.set(reference.path, { sha256: reference.sha256, mediaType: reference.mediaType, collection: document.collection })
      }
      if (document.body) {
        for (const reference of await collectPortableMdcAssetReferences(document.body.source, collection.componentPolicy)) {
          referenced.set(reference.path, { ...reference, collection: document.collection })
        }
      }
    } catch (error) {
      diagnostic(diagnostics, boundaryCode(error, 'DOCUMENT_INVALID'), 'portability.validateAssets', document.collection, null, null,
        message(error), 'Correct the managed asset reference in the source document.')
    }
  }

  const assets: PortableAssetWriteInput[] = []
  for (const [publicPath, reference] of [...referenced].sort(([left], [right]) => left.localeCompare(right))) {
    const file = `public${publicPath}`
    try {
      const path = join(rootDir, ...file.split('/'))
      const before = await lstat(path)
      const content = await readStableRegularFile(path, before, PORTABLE_CONTENT_LIMITS.assetBytes)
      const verified = await verifyPublicImageBytes(content, reference.mediaType)
      if (verified.sha256 !== reference.sha256) throw new TypeError('The asset bytes do not match the SHA-256 identity in the source reference.')
      assets.push({ sha256: verified.sha256, file, bytes: verified.bytes, mediaType: verified.mediaType, content })
    } catch (error) {
      diagnostic(diagnostics,
        error instanceof StableFileError && error.reason === 'limit' ? 'LIMIT_EXCEEDED' : 'ASSET_INTEGRITY_FAILED',
        'portability.validateAssets', reference.collection, file, null, message(error),
        'Restore the exact verified image at this public path, or correct the source reference.')
    }
  }
  return assets
}

function markdownBody(source: string): string {
  const normalized = source.replace(/\r\n?/g, '\n')
  if (!normalized.startsWith('---\n')) return normalized
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) {
    if (normalized.endsWith('\n---')) return ''
    throw new TypeError('Markdown frontmatter is not closed.')
  }
  return normalized.slice(end + 5)
}

function requiredRawSource(rawById: Map<string, string>, id: string): string {
  const source = rawById.get(id)
  if (source === undefined) throw new TypeError(`Raw Markdown source is unavailable for "${id}".`)
  return source
}

function routeSlug(document: ParsedContent, collection: ResolvedContentCollectionV1): string {
  if (collection.routing.singleton && collection.routing.rootSlug) return collection.routing.rootSlug
  const parts = (document.path ?? '').split('/').filter(Boolean)
  const slug = parts[parts.length - 1]
  if (!slug) throw new TypeError('A route-backed portable document requires a non-empty slug.')
  return slug
}

function treeParent(canonicalKey: string): string | null {
  const parts = canonicalKey.split('/').filter(Boolean)
  return parts.length > 1 ? parts.slice(0, -1).join('/') : null
}

function treeOrder(canonicalKey: string): string | null {
  const parts = canonicalKey.split('/')
  const segment = parts[parts.length - 1] ?? ''
  return /^\d+$/u.test(segment) ? BigInt(segment).toString(16).toUpperCase().padStart(16, '0') : null
}

function searchVisible(search: ModuleOptions['search'], collection: string): boolean {
  if (!search) return false
  if (search?.filterQuery && JSON.stringify(search.filterQuery) !== JSON.stringify({ partial: false })) {
    throw new TypeError('Custom content.search.filterQuery cannot be represented as per-document portable visibility without evaluating the application query.')
  }
  return !search.collections || search.collections.includes(collection)
}

function normalizeSitemap(value: Exclude<ModuleOptions['sitemap'], false>) {
  if (value === true) return { include: undefined, exclude: [] }
  return { include: value.include, exclude: value.exclude ?? [] }
}

function diagnostic(target: FilesystemPortabilityDiagnostic[], code: PortabilityErrorCode, operation: PortabilityOperation, collection: string | null, file: string | null, field: string | null, message: string, resolution: string) {
  target.push({ severity: 'error', code, operation, collection, file, field, message, resolution })
}

function boundaryCode(error: unknown, fallback: PortabilityErrorCode): PortabilityErrorCode {
  return error instanceof GinkoBoundaryError ? error.code : fallback
}
function message(error: unknown) { return error instanceof Error ? error.message : String(error) }
function fieldFrom(error: unknown): string | null {
  const context = (error as { context?: { path?: unknown; details?: unknown } })?.context
  if (Array.isArray(context?.path)) return context.path.join('.')
  if (typeof context?.details === 'string') return context.details.split(':', 1)[0] ?? null
  return null
}
function fieldFile(value: unknown): string | null {
  if (value && typeof value === 'object') {
    const item = value as { file?: { path?: string }; context?: { file?: string } }
    return item.file?.path ? `content/${item.file.path}` : item.context?.file ? `content/${item.context.file}` : null
  }
  return null
}
function variantKey(collection: string, canonicalKey: string, locale: string) { return `${collection}\0${canonicalKey}\0${locale}` }
function summarize(documents: PortableDocumentV1[], assets: PortableAssetBlobV1[]) {
  return {
    documents: documents.length,
    assets: assets.length,
    collections: [...new Set(documents.map(item => item.collection))].sort(),
    locales: [...new Set(documents.map(item => item.locale))].sort(),
  }
}
function emptyAssessment(rootDir: string, diagnostics: FilesystemPortabilityDiagnostic[]): FilesystemPortabilityAssessment {
  return { ok: false, rootDir, contract: null, documents: [], assets: [], diagnostics, evidence: null, summary: { documents: 0, assets: 0, collections: [], locales: [] } }
}
async function firstExisting(rootDir: string, names: readonly string[]) {
  for (const name of names) try { const path = join(rootDir, name); if ((await lstat(path)).isFile()) return path } catch { /* continue */ }
  return null
}
function unwrap(value: unknown): unknown {
  const record = value as { default?: unknown }
  return record && typeof record === 'object' && 'default' in record ? record.default : value
}
