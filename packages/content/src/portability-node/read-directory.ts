import { lstat, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertResolvedContentContract } from '../cms-contract/validate.js'
import { PORTABLE_CONTENT_LIMITS } from '../cms-contract/limits.js'
import {
  canonicalJsonBytes,
  hashCanonicalJson,
  sha256Hex,
  type JsonValue,
} from '../cms-contract/hash.js'
import { verifyPublicImageBytes } from '../cms-contract/asset-bytes.js'
import type { ResolvedContentContractV1 } from '../cms-contract/types.js'
import { parsePortableDocument } from '../portability/documents.js'
import { collectPortableAssetReferences, collectPortableMdcAssetReferences } from '../portability/assets.js'
import { portabilityError } from '../portability/errors.js'
import { parsePortableJson } from '../portability/json.js'
import { parsePortableManifest, serializePortableManifest } from '../portability/manifest.js'
import { collectPortableReferences } from '../portability/references.js'
import type { PortableAssetBlobV1, PortableDocumentV1, PortableManifestV1 } from '../portability/model.js'
import { portableCaseFold, validatePortableRelativePath } from './safe-path.js'
import { readStableRegularFile } from './streams.js'

const limits = PORTABLE_CONTENT_LIMITS

export interface PortableDirectoryDocument {
  file: string
  document: PortableDocumentV1
  bytes: Uint8Array
}

export interface PortableDirectoryAsset extends PortableAssetBlobV1 {
  content: Uint8Array
}

export interface PortableDirectoryBundle {
  contract: ResolvedContentContractV1
  documents: PortableDirectoryDocument[]
  assets: PortableDirectoryAsset[]
  manifest: PortableManifestV1
}

export interface PortableDirectoryPlanningDocument {
  file: string
  document: PortableDocumentV1
}

export interface PortableDirectoryPlanningBundle {
  contract: ResolvedContentContractV1
  documents: PortableDirectoryPlanningDocument[]
  assets: PortableAssetBlobV1[]
  manifest: PortableManifestV1
}

export interface PortableDirectoryPlanningLimits {
  documents: number
  assets: number
  documentBytes: number
  totalDocumentBytes: number
}

export async function readPortableDirectory(root: string): Promise<PortableDirectoryBundle> {
  return inspectPortableDirectory(root, true, 'all')
}

export async function readPortableDirectoryForPlanning(
  root: string,
  planningLimits: PortableDirectoryPlanningLimits,
): Promise<PortableDirectoryPlanningBundle> {
  assertPlanningLimits(planningLimits)
  return inspectPortableDirectory(root, true, 'planning', planningLimits)
}

export async function rebuildPortableDirectoryManifest(root: string): Promise<PortableManifestV1> {
  const result = await inspectPortableDirectory(root, false, 'none')
  const bytes = serializePortableManifest(result.manifest)
  const temporary = join(root, '.ginko', `portable.json.tmp-${process.pid}-${Date.now()}`)
  try {
    await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 })
    await rename(temporary, join(root, '.ginko', 'portable.json'))
  } catch (error) {
    throw error instanceof Error && error.name === 'GinkoBoundaryError' ? error : portabilityError('PATH_INVALID', 'directory.write', 'Portable manifest could not be written safely.')
  } finally {
    await rm(temporary, { force: true })
  }
  return result.manifest
}

export interface PortableDirectoryVerification {
  contract: ResolvedContentContractV1
  manifest: PortableManifestV1
}

export async function verifyPortableDirectoryBounded(
  root: string,
): Promise<PortableDirectoryVerification> {
  return await inspectPortableDirectory(root, true, 'none')
}

async function inspectPortableDirectory(
  root: string,
  verifyManifest: boolean,
  materialize: 'all',
): Promise<PortableDirectoryBundle>
async function inspectPortableDirectory(
  root: string,
  verifyManifest: boolean,
  materialize: 'planning',
  planningLimits: PortableDirectoryPlanningLimits,
): Promise<PortableDirectoryPlanningBundle>
async function inspectPortableDirectory(
  root: string,
  verifyManifest: boolean,
  materialize: 'none',
): Promise<PortableDirectoryVerification>
async function inspectPortableDirectory(
  root: string,
  verifyManifest: boolean,
  materialize: 'all' | 'planning' | 'none',
  planningLimits?: PortableDirectoryPlanningLimits,
): Promise<PortableDirectoryBundle | PortableDirectoryPlanningBundle | PortableDirectoryVerification> {
  const rootStats = await safeLstat(root)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw unsafePath()
  const files = await scanPaths(root)
  if (!files.includes('.ginko/content-contract.json')) {
    throw portabilityError('CONTRACT_INVALID', 'directory.read', 'Portable Content contract is missing.')
  }
  const contractBytes = await readPath(root, '.ginko/content-contract.json')
  let contract: ResolvedContentContractV1
  try {
    contract = assertResolvedContentContract(
      parsePortableJson(new TextDecoder('utf-8', { fatal: true }).decode(contractBytes)),
    )
  } catch {
    throw portabilityError('CONTRACT_INVALID', 'directory.read', 'Portable Content contract is invalid.')
  }
  const documents: PortableManifestV1['documents'] = []
  const assets: PortableManifestV1['assets'] = []
  const materializedDocuments: PortableDirectoryDocument[] = []
  const planningDocuments: PortableDirectoryPlanningDocument[] = []
  const materializedAssets: PortableDirectoryAsset[] = []
  let planningDocumentBytes = 0
  const variants = new Set<string>()
  const identities = new Map<string, Set<string>>()
  const sharedHashes = new Map<string, string>()
  const parents = new Map<string, string | null>()
  const relations: Array<{ collection: string; canonicalKey: string }> = []
  const referencedAssets = new Set<string>()
  for (const file of files) {
    if (!file.startsWith('content/')) continue
    if (documents.length >= limits.documents) throw limit()
    if (materialize === 'planning') {
      const bounded = planningLimits!
      if (
        planningDocuments.length >= bounded.documents
        || planningDocumentBytes >= bounded.totalDocumentBytes
      ) {
        throw limit()
      }
    }
    const bytes = await readPath(
      root,
      file,
      materialize === 'planning'
        ? Math.min(
            maximum(file),
            planningLimits!.documentBytes,
            planningLimits!.totalDocumentBytes - planningDocumentBytes,
          )
        : maximum(file),
    )
    const document = await parsePortableDocument(bytes, contract, file)
    if (materialize === 'all') materializedDocuments.push({ file, bytes, document })
    if (materialize === 'planning') {
      const bounded = planningLimits!
      planningDocumentBytes += bytes.byteLength
      if (
        planningDocuments.length >= bounded.documents
        || bytes.byteLength > bounded.documentBytes
        || planningDocumentBytes > bounded.totalDocumentBytes
      ) {
        throw limit()
      }
      planningDocuments.push({ file, document })
    }
    const variant = factKey(document.collection, document.canonicalKey, document.locale)
    if (variants.has(variant)) {
      throw portabilityError(
        'IDENTITY_CONFLICT',
        'directory.verify',
        'Portable document identity is duplicated.',
      )
    }
    variants.add(variant)
    const identity = factKey(document.collection, document.canonicalKey)
    const locales = identities.get(identity) ?? new Set<string>()
    locales.add(document.locale)
    identities.set(identity, locales)
    const sharedHash = await sha256Hex(canonicalJsonBytes(document.shared))
    const priorSharedHash = sharedHashes.get(identity)
    if (priorSharedHash && priorSharedHash !== sharedHash) {
      throw portabilityError(
        'SHARED_FIELD_DIVERGENCE',
        'directory.verify',
        'Shared fields diverge between locale variants.',
      )
    }
    sharedHashes.set(identity, sharedHash)
    parents.set(variant, document.parentCanonicalKey)
    const collection = contract.collections[document.collection]!
    relations.push(
      ...collectPortableReferences(collection.fields, {
        ...document.shared,
        ...document.localized,
      }),
    )
    for (const reference of collectPortableAssetReferences(collection.fields, {
      ...document.shared,
      ...document.localized,
    })) {
      if (reference.kind === 'local') referencedAssets.add(reference.sha256)
    }
    if (document.body) {
      for (const reference of await collectPortableMdcAssetReferences(
        document.body.source,
        collection.componentPolicy,
      )) {
        referencedAssets.add(reference.sha256)
      }
    }
    documents.push({
      identity: {
        collection: document.collection,
        canonicalKey: document.canonicalKey,
        locale: document.locale,
      },
      file,
      sha256: await sha256Hex(bytes),
    })
  }
  validateDocumentFacts(contract, variants, identities, parents, relations)
  const assetHashes = new Set<string>()
  for (const file of files) {
    if (!file.startsWith('public/ginko-assets/')) continue
    if (materialize === 'planning' && assets.length >= planningLimits!.assets) throw limit()
    const asset = await assetFromFile(file, await readPath(root, file))
    if (materialize === 'all') materializedAssets.push(asset)
    if (assetHashes.has(asset.sha256)) {
      throw portabilityError(
        'ASSET_INTEGRITY_FAILED',
        'directory.verify',
        'Portable asset identity is duplicated.',
      )
    }
    assetHashes.add(asset.sha256)
    const { content: _content, ...facts } = asset
    assets.push(facts)
  }
  for (const sha256 of referencedAssets) {
    if (!assetHashes.has(sha256)) {
      throw portabilityError('ASSET_MISSING', 'directory.verify', 'Portable asset file is missing.')
    }
  }
  for (const sha256 of assetHashes) {
    if (!referencedAssets.has(sha256)) {
      throw portabilityError(
        'ASSET_INTEGRITY_FAILED',
        'directory.verify',
        'Portable asset file is unreferenced.',
      )
    }
  }
  documents.sort(
    (left, right) =>
      compare(left.identity.collection, right.identity.collection) ||
      compare(left.identity.canonicalKey, right.identity.canonicalKey) ||
      compare(left.identity.locale, right.identity.locale) ||
      compare(left.file, right.file),
  )
  assets.sort((left, right) => compare(left.sha256, right.sha256))
  materializedDocuments.sort((left, right) => compare(left.file, right.file))
  materializedAssets.sort((left, right) => compare(left.sha256, right.sha256))
  const manifest: PortableManifestV1 = {
    format: 'ginko-content-portable',
    version: 1,
    contract: {
      file: '.ginko/content-contract.json',
      sha256: await hashCanonicalJson(contract as unknown as JsonValue),
    },
    documents,
    assets,
  }
  const manifestBytes = serializePortableManifest(manifest)
  if (verifyManifest) {
    if (!files.includes('.ginko/portable.json')) {
      throw portabilityError('DOCUMENT_INVALID', 'directory.verify', 'Portable manifest is missing.')
    }
    const indexed = parsePortableManifest(await readPath(root, '.ginko/portable.json'))
    if (indexed.contract.sha256 !== manifest.contract.sha256) {
      throw portabilityError(
        'CONTRACT_HASH_MISMATCH',
        'directory.verify',
        'Portable contract hash does not match the manifest.',
      )
    }
    if (!equalBytes(serializePortableManifest(indexed), manifestBytes)) {
      throw portabilityError(
        'DOCUMENT_INVALID',
        'directory.verify',
        'Portable manifest does not match directory bytes.',
      )
    }
  }
  if (materialize === 'all') {
    return { contract, documents: materializedDocuments, assets: materializedAssets, manifest }
  }
  if (materialize === 'planning') {
    return { contract, documents: planningDocuments, assets, manifest }
  }
  return { contract, manifest }
}

function assertPlanningLimits(value: PortableDirectoryPlanningLimits): void {
  for (const limitValue of [
    value.documents,
    value.assets,
    value.documentBytes,
    value.totalDocumentBytes,
  ]) {
    if (!Number.isSafeInteger(limitValue) || limitValue <= 0) {
      throw new TypeError('Portable directory planning limits must be positive safe integers.')
    }
  }
  if (
    value.documents > limits.documents
    || value.documentBytes > limits.documentBytes
    || value.totalDocumentBytes > limits.totalBytes
  ) {
    throw new TypeError('Portable directory planning limits exceed the portable format limits.')
  }
}

function validateDocumentFacts(
  contract: ResolvedContentContractV1,
  variants: Set<string>,
  identities: Map<string, Set<string>>,
  parents: Map<string, string | null>,
  relations: Array<{ collection: string; canonicalKey: string }>,
) {
  for (const [variant, parent] of parents) {
    if (!parent) continue
    const [collection, canonicalKey, locale] = variant.split('\u0000') as [string, string, string]
    if (parent === canonicalKey || !variants.has(factKey(collection, parent, locale))) {
      throw portabilityError(
        'REFERENCE_MISSING',
        'directory.verify',
        'Portable parent reference is missing.',
      )
    }
  }
  for (const reference of relations) {
    const target = contract.collections[reference.collection]
    if (
      !target ||
      !identities.get(factKey(reference.collection, reference.canonicalKey))?.has(target.defaultLocale)
    ) {
      throw portabilityError(
        'REFERENCE_MISSING',
        'directory.verify',
        'Portable relation target is missing.',
      )
    }
  }
  for (const collection of Object.values(contract.collections)) {
    if (collection.structure !== 'tree') continue
    for (const locale of collection.locales) {
      for (const variant of parents.keys()) {
        const [variantCollection, start, variantLocale] = variant.split('\u0000') as [
          string,
          string,
          string,
        ]
        if (variantCollection !== collection.id || variantLocale !== locale) continue
        const seen = new Set<string>()
        let current: string | null | undefined = start
        while (current) {
          if (seen.has(current)) {
            throw portabilityError(
              'REFERENCE_CYCLE',
              'directory.verify',
              'Portable parent references contain a cycle.',
            )
          }
          seen.add(current)
          current = parents.get(factKey(collection.id, current, locale))
        }
      }
    }
  }
}

async function scanPaths(root: string): Promise<string[]> {
  const files: string[] = []
  const folded = new Set<string>()
  const identities = new Set<string>()
  let totalBytes = 0
  let fileCount = 0
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    if (prefix && entries.length === 0) throw unsafePath()
    for (const entry of entries.sort((left, right) => compare(left.name, right.name))) {
      const file = validatePortableRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name)
      const fold = portableCaseFold(file)
      if (folded.has(fold)) {
        throw portabilityError(
          'PATH_COLLISION',
          'directory.verify',
          'Portable paths collide after Unicode case folding.',
        )
      }
      folded.add(fold)
      const absolute = join(root, ...file.split('/'))
      const stats = await safeLstat(absolute)
      if (stats.isSymbolicLink()) throw unsafePath()
      if (stats.isDirectory()) {
        await visit(absolute, file)
        continue
      }
      if (!allowed(file)) throw unsafePath()
      const identity = `${stats.dev}:${stats.ino}`
      if (identities.has(identity) || stats.nlink !== 1) throw unsafePath()
      identities.add(identity)
      totalBytes += stats.size
      fileCount += 1
      if (fileCount > limits.files || totalBytes > limits.totalBytes || stats.size > maximum(file)) {
        throw limit()
      }
      files.push(file)
    }
  }
  await visit(root, '')
  return files
}

async function readPath(root: string, file: string, maximumBytes = maximum(file)) {
  const absolute = join(root, ...file.split('/'))
  const stats = await safeLstat(absolute)
  if (!stats.isFile() || stats.isSymbolicLink()) throw unsafePath()
  return await readStableRegularFile(absolute, stats, maximumBytes)
}

const factKey = (...parts: string[]) => parts.join('\u0000')

function allowed(file: string): boolean {
  if (file === '.ginko/content-contract.json' || file === '.ginko/portable.json') return true
  if (file.startsWith('content/')) return /\.(?:md|mdc|markdown|ya?ml|json)$/.test(file)
  return /^public\/ginko-assets\/[0-9a-f]{64}\.(?:png|jpg|gif|webp)$/.test(file)
}

const maximum = (file: string) => file === '.ginko/content-contract.json' ? limits.contractBytes : file === '.ginko/portable.json' ? limits.manifestBytes : file.startsWith('content/') ? limits.documentBytes : limits.assetBytes

async function assetFromFile(file: string, content: Uint8Array): Promise<PortableDirectoryAsset> {
  const match = /^public\/ginko-assets\/([0-9a-f]{64})\.(png|jpg|gif|webp)$/.exec(file)
  if (!match) throw unsafePath()
  const claimed = { png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[match[2]!]!
  let verified
  try { verified = await verifyPublicImageBytes(content, claimed) } catch { throw portabilityError('ASSET_TYPE_UNSUPPORTED', 'directory.verify', 'Portable asset bytes are unsupported.') }
  if (verified.sha256 !== match[1]) throw portabilityError('ASSET_INTEGRITY_FAILED', 'directory.verify', 'Portable asset filename hash does not match its bytes.')
  return { sha256: verified.sha256, file, bytes: verified.bytes, mediaType: verified.mediaType, content }
}

async function safeLstat(path: string) {
  try { return await lstat(path) } catch { throw unsafePath() }
}
const unsafePath = () => portabilityError('PATH_INVALID', 'directory.verify', 'Portable filesystem entry is unsafe.')
const limit = () => portabilityError('LIMIT_EXCEEDED', 'directory.verify', 'Portable directory exceeds a supported limit.')
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0
const equalBytes = (left: Uint8Array, right: Uint8Array) => left.length === right.length && left.every((byte, index) => right[index] === byte)
