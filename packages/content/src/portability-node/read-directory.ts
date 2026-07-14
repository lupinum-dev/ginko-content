import { lstat, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { assertResolvedContentContract } from '../cms-contract/validate.js'
import { verifyPublicImageBytes } from '../cms-contract/asset-bytes.js'
import type { ResolvedContentContractV1 } from '../cms-contract/types.js'
import { parsePortableDocument } from '../portability/documents.js'
import { portabilityError } from '../portability/errors.js'
import { parsePortableJson } from '../portability/json.js'
import { parsePortableManifest, rebuildPortableManifest, serializePortableManifest } from '../portability/manifest.js'
import type { PortableAssetBlobV1, PortableDocumentV1, PortableManifestV1 } from '../portability/model.js'
import { portableCaseFold, validatePortableRelativePath } from './safe-path.js'
import { readStableRegularFile } from './streams.js'

const limits = {
  documents: 100_000,
  files: 200_000,
  documentBytes: 2 * 1024 * 1024,
  assetBytes: 25 * 1024 * 1024,
  contractBytes: 4 * 1024 * 1024,
  manifestBytes: 32 * 1024 * 1024,
  totalBytes: 10 * 1024 * 1024 * 1024,
}

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

export async function readPortableDirectory(root: string): Promise<PortableDirectoryBundle> {
  return inspectPortableDirectory(root, true)
}

export async function verifyPortableDirectory(root: string): Promise<PortableDirectoryBundle> {
  return inspectPortableDirectory(root, true)
}

export async function rebuildPortableDirectoryManifest(root: string): Promise<PortableManifestV1> {
  const result = await inspectPortableDirectory(root, false)
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

async function inspectPortableDirectory(root: string, verifyManifest: boolean): Promise<PortableDirectoryBundle> {
  const rootStats = await safeLstat(root)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw unsafePath()
  const files = await scan(root)
  const contractFile = files.get('.ginko/content-contract.json')
  if (!contractFile) throw portabilityError('CONTRACT_INVALID', 'directory.read', 'Portable Content contract is missing.')
  let contract: ResolvedContentContractV1
  try { contract = assertResolvedContentContract(parsePortableJson(new TextDecoder('utf-8', { fatal: true }).decode(contractFile))) } catch { throw portabilityError('CONTRACT_INVALID', 'directory.read', 'Portable Content contract is invalid.') }
  const documents: PortableDirectoryDocument[] = []
  const assets: PortableDirectoryAsset[] = []
  for (const [file, bytes] of files) {
    if (file.startsWith('content/')) documents.push({ file, bytes, document: await parsePortableDocument(bytes, contract, file) })
    else if (file.startsWith('public/ginko-assets/')) assets.push(await assetFromFile(file, bytes))
  }
  if (documents.length > limits.documents) throw limit()
  documents.sort((left, right) => compare(left.file, right.file))
  assets.sort((left, right) => compare(left.sha256, right.sha256))
  const manifest = await rebuildPortableManifest({ contract, documents, assets })
  if (verifyManifest) {
    const indexed = files.get('.ginko/portable.json')
    if (!indexed) throw portabilityError('DOCUMENT_INVALID', 'directory.verify', 'Portable manifest is missing.')
    const parsed = parsePortableManifest(indexed)
    if (parsed.contract.sha256 !== manifest.contract.sha256) throw portabilityError('CONTRACT_HASH_MISMATCH', 'directory.verify', 'Portable contract hash does not match the manifest.')
    if (!equalBytes(serializePortableManifest(parsed), serializePortableManifest(manifest))) throw portabilityError('DOCUMENT_INVALID', 'directory.verify', 'Portable manifest does not match directory bytes.')
  }
  return { contract, documents, assets, manifest }
}

async function scan(root: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>()
  const folded = new Set<string>()
  const identities = new Set<string>()
  let totalBytes = 0
  const visit = async (directory: string, prefix: string): Promise<number> => {
    const entries = await readdir(directory, { withFileTypes: true })
    if (prefix && entries.length === 0) throw unsafePath()
    for (const entry of entries.sort((left, right) => compare(left.name, right.name))) {
      const file = validatePortableRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name)
      const fold = portableCaseFold(file)
      if (folded.has(fold)) throw portabilityError('PATH_COLLISION', 'directory.verify', 'Portable paths collide after Unicode case folding.')
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
      const bytes = await readStableRegularFile(absolute, stats, maximum(file))
      totalBytes += bytes.length
      if (++fileCount > limits.files || totalBytes > limits.totalBytes) throw limit()
      files.set(file, bytes)
    }
    return entries.length
  }
  let fileCount = 0
  await visit(root, '')
  return files
}

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
