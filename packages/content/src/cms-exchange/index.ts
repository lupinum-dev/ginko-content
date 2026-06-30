import { readFile, readdir } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { dump as dumpYaml } from 'js-yaml'

import {
  buildCmsImportGraph,
  parseCmsImportFile,
  type CmsImportContentContext,
  type CmsImportParsedFile,
} from '../cms-import/index.js'
import type { ContentGraph } from '../core/content/graph.js'
import { normalizeContentPath, slugifyUrlSegment } from '../cms-contract/index.js'
import type { CmsCollectionContract, CmsContract, CmsFieldContract } from '../cms-contract/index.js'
import type { ParsedContent } from '../types/content.js'

export {
  buildCmsImportGraph,
  parseCmsImportFile,
  type CmsImportContentContext,
  type CmsImportParsedFile,
}

export type CmsExchangeExtension = 'md' | 'mdc' | 'markdown' | 'json' | 'json5' | 'yaml' | 'yml'

export type CmsExchangeWarning = {
  code: string
  message: string
  sourcePath?: string
}

export type CmsExchangeAssetReference = {
  sourcePath: string
  referencedBy: string[]
  checksum?: string
}

export type CmsExchangeDocument = {
  stableId: string
  collection: string
  locale: string
  path: string
  sourcePath?: string
  sourceChecksum?: string
  extension: CmsExchangeExtension
  frontmatter: Record<string, unknown>
  values: Record<string, unknown>
  bodyMdc?: string
  parentStableId?: string
  sortOrder?: number
}

export type CmsExchangeManifest = {
  version: 1
  generatedAt: string
  generator: string
  contractChecksum?: string
  documents: Array<{
    stableId: string
    collection: string
    locale: string
    path: string
    sourcePath: string
    checksum: string
  }>
  assets: Array<{
    sourcePath: string
    checksum?: string
    referencedBy: string[]
  }>
  warnings: CmsExchangeWarning[]
}

export type CmsExchangeImportFile = {
  id: string
  source: string
  sourcePath?: string
}

export type ReadCmsExchangeFilesOptions = {
  rootDir: string
  extensions?: CmsExchangeExtension[]
}

export type CmsExchangeImportPlan = {
  version: 1
  sourceRoot?: string
  generatedAt: string
  contractChecksum?: string
  defaultLocale: string
  locales: string[]
  documents: CmsExchangeDocument[]
  assets: CmsExchangeAssetReference[]
  warnings: CmsExchangeWarning[]
  graph: ContentGraph
}

export type CmsExchangeRenderedFile = {
  path: string
  kind: 'content' | 'manifest'
  contentType: string
  text: string
  checksum: string
}

export type CreateCmsExchangeImportPlanOptions = {
  files: CmsExchangeImportFile[]
  context: CmsImportContentContext
  contract: CmsContract
  sourceRoot?: string
  contractChecksum?: string
  generatedAt?: string
}

export type RenderCmsExchangeFileOptions = {
  document: CmsExchangeDocument
  contract: CmsContract
  exportedAt?: string
  source?: string
  entryId?: string
  revisionId?: string
  path?: string
}

const markdownExtensions = new Set(['md', 'mdc', 'markdown'])
const exchangeFileExtensions = new Set(['.md', '.mdc', '.markdown', '.json', '.json5', '.yaml', '.yml'])
const exchangeManifestFilename = 'ginko-cms-export.json'
const localAssetReferencePattern = /(?:!\[[^\]]*]\(|\[[^\]]*]\(|\bsrc=["'])(?!https?:\/\/|data:|#|\/)([^)"'\s]+)(?:[)"'])/g

function normalizeExtension(value: unknown): CmsExchangeExtension | null {
  if (typeof value !== 'string') return null
  const extension = value.toLowerCase()
  if (
    extension === 'md' ||
    extension === 'mdc' ||
    extension === 'markdown' ||
    extension === 'json' ||
    extension === 'json5' ||
    extension === 'yaml' ||
    extension === 'yml'
  ) {
    return extension
  }
  return null
}

function normalizeSourcePath(rootDir: string, path: string) {
  return relative(rootDir, path).split('\\').join('/')
}

function normalizeRoute(path: string | undefined) {
  return normalizeContentPath(path || '/')
}

function checksumText(text: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`
}

function fieldIsBody(field: CmsFieldContract) {
  return field.role === 'body' || field.key === 'bodyMdc'
}

function collectionForDocument(contract: CmsContract, document: ParsedContent) {
  const collectionSlug = typeof document._collection === 'string' ? document._collection : ''
  return collectionSlug ? contract.collections[collectionSlug] : undefined
}

function stringFrontmatter(value: Record<string, unknown>, key: string) {
  const field = value[key]
  return typeof field === 'string' && field.trim() ? field.trim() : null
}

function numberFrontmatter(value: Record<string, unknown>, key: string) {
  const field = value[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : null
}

function stableIdForDocument(args: {
  frontmatter: Record<string, unknown>
  collection: CmsCollectionContract
  document: ParsedContent
}) {
  const explicitRef = stringFrontmatter(args.frontmatter, 'ref')
  if (explicitRef) return explicitRef

  const canonicalKey = typeof args.document._canonicalKey === 'string' && args.document._canonicalKey
    ? args.document._canonicalKey
    : normalizeRoute(args.document._path)
  return `${args.collection.slug}:${canonicalKey.replace(/^\/+/, '') || 'index'}`
}

function sourcePathForFile(file: CmsExchangeImportFile, parsed: CmsImportParsedFile) {
  if (file.sourcePath) return file.sourcePath
  const fromDocument = typeof parsed.document._file === 'string' ? parsed.document._file : null
  return fromDocument || file.id.replace(/^[^:]+:/, '')
}

function sortOrderForSource(sourcePath: string, frontmatter: Record<string, unknown>) {
  const explicit = numberFrontmatter(frontmatter, 'sortOrder')
  if (explicit !== null) return explicit
  const filename = sourcePath.split('/').pop() ?? ''
  const match = filename.match(/^(\d+)\./)
  return match ? Number(match[1]) : 0
}

function routeSlug(path: string, collection: CmsCollectionContract) {
  const prefix = collection.routing.pathPrefix.replace(/\/+$/, '')
  const normalizedPath = normalizeRoute(path)
  if (prefix && normalizedPath === prefix) {
    return collection.routing.rootSlug || 'index'
  }
  const withoutPrefix = prefix && normalizedPath.startsWith(`${prefix}/`)
    ? normalizedPath.slice(prefix.length + 1)
    : normalizedPath.replace(/^\/+/, '')
  const segments = withoutPrefix.split('/').filter(Boolean)
  return segments[segments.length - 1] || collection.routing.rootSlug || 'index'
}

function isSafeExchangePath(path: string) {
  const normalized = path.split('\\').join('/')
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return false
  if (normalized.split('/').some(segment => !segment || segment === '.' || segment === '..')) return false
  if (normalized === exchangeManifestFilename || normalized.endsWith(`/${exchangeManifestFilename}`)) return false
  return exchangeFileExtensions.has(extname(normalized).toLowerCase())
}

function extractValues(args: {
  frontmatter: Record<string, unknown>
  collection: CmsCollectionContract
}) {
  const values: Record<string, unknown> = {}
  const blocked = new Set(['ref', 'parentRef', 'sortOrder', 'locale', 'cms', 'bodyMdc'])
  for (const field of args.collection.fields) {
    if (fieldIsBody(field) || field.hidden || blocked.has(field.key)) continue
    if (Object.prototype.hasOwnProperty.call(args.frontmatter, field.key)) {
      values[field.key] = args.frontmatter[field.key]
    }
  }
  return values
}

function createDocument(args: {
  file: CmsExchangeImportFile
  parsed: CmsImportParsedFile
  contract: CmsContract
}): { document?: CmsExchangeDocument; warning?: CmsExchangeWarning } {
  const collection = collectionForDocument(args.contract, args.parsed.document)
  const sourcePath = sourcePathForFile(args.file, args.parsed)
  if (!collection) {
    return {
      warning: {
        code: 'unsupported_collection',
        message: 'File did not resolve to a CMS contract collection.',
        sourcePath,
      },
    }
  }
  const extension = normalizeExtension(args.parsed.document._extension ?? sourcePath.split('.').pop())
  if (!extension || !markdownExtensions.has(extension)) {
    return {
      warning: {
        code: 'unsupported_extension',
        message: 'Only route-backed Markdown/MDC files are supported by the MVP exchange plan.',
        sourcePath,
      },
    }
  }
  if (collection.routing.mode !== 'route') {
    return {
      warning: {
        code: 'unsupported_collection_routing',
        message: 'Only route-backed Markdown/MDC collections are supported by the MVP exchange plan.',
        sourcePath,
      },
    }
  }

  const path = normalizeRoute(args.parsed.document._path)
  const frontmatter = { ...args.parsed.frontmatter }
  return {
    document: {
      stableId: stableIdForDocument({
        frontmatter,
        collection,
        document: args.parsed.document,
      }),
      collection: collection.slug,
      locale: typeof args.parsed.document._locale === 'string'
        ? args.parsed.document._locale
        : collection.defaultLocale,
      path,
      sourcePath,
      sourceChecksum: checksumText(args.file.source),
      extension,
      frontmatter,
      values: extractValues({ frontmatter, collection }),
      bodyMdc: args.parsed.body,
      parentStableId: stringFrontmatter(frontmatter, 'parentRef') ?? undefined,
      sortOrder: sortOrderForSource(sourcePath, frontmatter),
    },
  }
}

function attachTreeParents(documents: CmsExchangeDocument[], contract: CmsContract) {
  const byCollectionLocalePath = new Map<string, CmsExchangeDocument>()
  for (const document of documents) {
    byCollectionLocalePath.set(`${document.collection}:${document.locale}:${document.path}`, document)
  }

  for (const document of documents) {
    const collection = contract.collections[document.collection]
    if (!collection || collection.type !== 'tree' || document.parentStableId) continue

    const pathSegments = document.path.split('/').filter(Boolean)
    if (pathSegments.length <= 1) continue
    const parentPath = `/${pathSegments.slice(0, -1).join('/')}`
    const parent = byCollectionLocalePath.get(`${document.collection}:${document.locale}:${parentPath}`)
    if (parent) document.parentStableId = parent.stableId
  }
}

function sortDocumentsForImport(documents: CmsExchangeDocument[]) {
  const byCollectionStableId = new Map<string, CmsExchangeDocument>()
  for (const document of documents) {
    byCollectionStableId.set(`${document.collection}:${document.stableId}`, document)
  }

  const depthCache = new Map<string, number>()
  function depthFor(document: CmsExchangeDocument, seen = new Set<string>()): number {
    const key = `${document.collection}:${document.stableId}`
    const cached = depthCache.get(key)
    if (cached !== undefined) return cached
    if (!document.parentStableId || seen.has(key)) {
      depthCache.set(key, 0)
      return 0
    }
    seen.add(key)
    const parent = byCollectionStableId.get(`${document.collection}:${document.parentStableId}`)
    const depth = parent ? depthFor(parent, seen) + 1 : 0
    depthCache.set(key, depth)
    return depth
  }

  documents.sort((left, right) =>
    left.collection.localeCompare(right.collection) ||
    left.locale.localeCompare(right.locale) ||
    depthFor(left) - depthFor(right) ||
    (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
    left.path.localeCompare(right.path) ||
    left.stableId.localeCompare(right.stableId),
  )
}

export async function createCmsExchangeImportPlan(
  options: CreateCmsExchangeImportPlanOptions,
): Promise<CmsExchangeImportPlan> {
  const parsed: CmsImportParsedFile[] = []
  const warnings: CmsExchangeWarning[] = []
  const documents: CmsExchangeDocument[] = []

  for (const file of options.files) {
    const parsedFile = await parseCmsImportFile({
      id: file.id,
      source: file.source,
      context: options.context,
    })
    parsed.push(parsedFile)
    const result = createDocument({
      file,
      parsed: parsedFile,
      contract: options.contract,
    })
    if (result.document) documents.push(result.document)
    if (result.warning) warnings.push(result.warning)
  }

  attachTreeParents(documents, options.contract)
  sortDocumentsForImport(documents)

  const assets = scanCmsAssetReferences(documents)
  return {
    version: 1,
    sourceRoot: options.sourceRoot,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    contractChecksum: options.contractChecksum,
    defaultLocale: options.context.defaultLocale ?? 'en',
    locales: options.context.locales ?? [],
    documents,
    assets,
    warnings,
    graph: buildCmsImportGraph(parsed.map(file => file.document), {
      locales: options.context.locales,
      defaultLocale: options.context.defaultLocale,
    }),
  }
}

export const createCmsFilesystemImportPlan = createCmsExchangeImportPlan

export async function readCmsExchangeFilesFromDirectory(
  options: ReadCmsExchangeFilesOptions,
): Promise<CmsExchangeImportFile[]> {
  const rootDir = resolve(options.rootDir)
  const allowedExtensions = new Set((options.extensions ?? [])
    .map(extension => extension.startsWith('.') ? extension : `.${extension}`)
    .map(extension => extension.toLowerCase()))
  const extensions = allowedExtensions.size > 0 ? allowedExtensions : exchangeFileExtensions
  const files: CmsExchangeImportFile[] = []

  async function visit(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const path = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile() && entry.name !== exchangeManifestFilename && extensions.has(extname(entry.name).toLowerCase())) {
        const sourcePath = normalizeSourcePath(rootDir, path)
        files.push({
          id: `content:${sourcePath}`,
          sourcePath,
          source: await readFile(path, 'utf8'),
        })
      }
    }
  }

  await visit(rootDir)
  return files.sort((left, right) => (left.sourcePath ?? left.id).localeCompare(right.sourcePath ?? right.id))
}

export function scanCmsAssetReferences(documents: CmsExchangeDocument[]): CmsExchangeAssetReference[] {
  const referencedByPath = new Map<string, Set<string>>()
  for (const document of documents) {
    const haystack = [
      document.bodyMdc ?? '',
      ...Object.values(document.values).filter((value): value is string => typeof value === 'string'),
    ].join('\n')

    for (const match of haystack.matchAll(localAssetReferencePattern)) {
      const sourcePath = match[1]
      if (!sourcePath) continue
      referencedByPath.set(sourcePath, referencedByPath.get(sourcePath) ?? new Set())
      referencedByPath.get(sourcePath)!.add(document.sourcePath ?? document.path)
    }
  }

  return [...referencedByPath.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([sourcePath, referencedBy]) => ({
      sourcePath,
      referencedBy: [...referencedBy].sort(),
    }))
}

export function resolveCmsExportPath(document: CmsExchangeDocument, contract: CmsContract) {
  if (document.sourcePath && isSafeExchangePath(document.sourcePath)) return document.sourcePath
  const collection = contract.collections[document.collection]
  const extension = document.extension === 'mdc' ? 'mdc' : 'md'
  const localePrefix = document.locale && document.locale !== contract.defaultLocale
    ? `${slugifyUrlSegment(document.locale)}/`
    : ''
  if (!collection || collection.type !== 'tree') {
    return `${localePrefix}${slugifyUrlSegment(document.collection)}/${slugifyUrlSegment(routeSlug(document.path, collection ?? {
      routing: { pathPrefix: '', rootSlug: null },
    } as CmsCollectionContract))}.${extension}`
  }

  const prefix = collection.routing.pathPrefix.replace(/\/+$/, '')
  const normalizedPath = normalizeRoute(document.path)
  const remainder = prefix && normalizedPath.startsWith(`${prefix}/`)
    ? normalizedPath.slice(prefix.length + 1)
    : normalizedPath.replace(/^\/+/, '')
  const treePath = remainder || 'index'
  return `${localePrefix}${slugifyUrlSegment(document.collection)}/${treePath}.${extension}`
}

function renderFrontmatter(document: CmsExchangeDocument, options: RenderCmsExchangeFileOptions) {
  const cms: Record<string, unknown> = {
    source: options.source ?? 'ginko-content-exchange',
  }
  if (options.entryId) cms.entryId = options.entryId
  if (options.revisionId) cms.revisionId = options.revisionId
  if (options.exportedAt) cms.exportedAt = options.exportedAt

  const frontmatter: Record<string, unknown> = {
    ...document.values,
    ref: document.stableId,
    locale: document.locale,
  }
  if (document.parentStableId) frontmatter.parentRef = document.parentStableId
  if (document.sortOrder !== undefined) frontmatter.sortOrder = document.sortOrder
  if (Object.keys(cms).length > 1 || cms.source !== 'ginko-content-exchange') {
    frontmatter.cms = cms
  }
  return frontmatter
}

export function renderCmsExchangeFile(options: RenderCmsExchangeFileOptions): CmsExchangeRenderedFile {
  const path = options.path ?? resolveCmsExportPath(options.document, options.contract)
  const frontmatter = renderFrontmatter(options.document, options)
  const yaml = dumpYaml(frontmatter, {
    lineWidth: 100,
    noRefs: true,
    sortKeys: true,
  }).trim()
  const body = options.document.bodyMdc?.trim() ?? ''
  const text = `---\n${yaml}\n---${body ? `\n\n${body}\n` : '\n'}`
  return {
    path,
    kind: 'content',
    contentType: options.document.extension === 'mdc' ? 'text/mdc; charset=utf-8' : 'text/markdown; charset=utf-8',
    text,
    checksum: checksumText(text),
  }
}

function warningsForUnbundledAssets(assets: CmsExchangeAssetReference[]) {
  const warnings: CmsExchangeWarning[] = []
  for (const asset of assets) {
    if (asset.checksum) continue
    warnings.push({
      code: 'asset_not_bundled',
      message: `Asset "${asset.sourcePath}" is referenced but is not bundled by this exchange artifact.`,
      sourcePath: asset.sourcePath,
    })
  }
  return warnings
}

export function renderCmsExchangeManifest(args: {
  files: CmsExchangeRenderedFile[]
  documents: CmsExchangeDocument[]
  assets?: CmsExchangeAssetReference[]
  warnings?: CmsExchangeWarning[]
  generatedAt?: string
  generator?: string
  contractChecksum?: string
}): CmsExchangeRenderedFile {
  const documentsByPath = new Map(args.files.map((file, index) => [file.path, args.documents[index]]))
  const assets = args.assets ?? []
  const warnings = [
    ...(args.warnings ?? []),
    ...warningsForUnbundledAssets(assets),
  ]
  const manifest: CmsExchangeManifest = {
    version: 1,
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    generator: args.generator ?? 'ginko-content/cms-exchange',
    contractChecksum: args.contractChecksum,
    documents: args.files.map((file) => {
      const document = documentsByPath.get(file.path)
      return {
        stableId: document?.stableId ?? '',
        collection: document?.collection ?? '',
        locale: document?.locale ?? '',
        path: document?.path ?? '',
        sourcePath: file.path,
        checksum: file.checksum,
      }
    }),
    assets,
    warnings,
  }
  const text = `${JSON.stringify(manifest, null, 2)}\n`
  return {
    path: 'ginko-cms-export.json',
    kind: 'manifest',
    contentType: 'application/json; charset=utf-8',
    text,
    checksum: checksumText(text),
  }
}
