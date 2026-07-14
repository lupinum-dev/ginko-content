import { assertResolvedContentContract } from '../cms-contract/validate.js'
import { canonicalJsonBytes, hashCanonicalJson, sha256Hex, type JsonValue } from '../cms-contract/hash.js'
import type { ResolvedContentContractV1 } from '../cms-contract/types.js'
import { portabilityError } from './errors.js'
import { validatePortableAssets } from './assets.js'
import type { PortableAssetBlobV1, PortableDocumentV1, PortableManifestV1 } from './model.js'
import { validatePortableReferences } from './references.js'
import { parsePortableJson } from './json.js'

const manifestKeys = ['format', 'version', 'contract', 'documents', 'assets']

export function serializePortableManifest(manifest: PortableManifestV1): Uint8Array {
  assertPortableManifest(manifest)
  const canonical = canonicalJsonBytes(manifest as unknown as JsonValue)
  const bytes = new Uint8Array(canonical.length + 1)
  bytes.set(canonical)
  bytes[bytes.length - 1] = 0x0A
  return bytes
}

export function parsePortableManifest(input: string | Uint8Array): PortableManifestV1 {
  try {
    const source = typeof input === 'string' ? input : new TextDecoder('utf-8', { fatal: true }).decode(input)
    if (new TextEncoder().encode(source).length > 32 * 1024 * 1024) throw portabilityError('LIMIT_EXCEEDED', 'portability.parse', 'Portable manifest exceeds 32 MiB.')
    return assertPortableManifest(parsePortableJson(source))
  } catch (error) {
    if (error instanceof Error && error.name === 'GinkoBoundaryError') throw error
    throw portabilityError('DOCUMENT_INVALID', 'portability.parse', 'Portable manifest is invalid.')
  }
}

export function assertPortableManifest(value: unknown): PortableManifestV1 {
  if (!record(value) || !exact(value, manifestKeys) || value.format !== 'ginko-content-portable' || value.version !== 1 || !record(value.contract) || !exact(value.contract, ['file', 'sha256']) || value.contract.file !== '.ginko/content-contract.json' || !hash(value.contract.sha256) || !Array.isArray(value.documents) || !Array.isArray(value.assets)) throw invalid()
  let priorDocument = ''
  const identities = new Set<string>()
  for (const document of value.documents) {
    if (!record(document) || !exact(document, ['identity', 'file', 'sha256']) || !record(document.identity) || !exact(document.identity, ['collection', 'canonicalKey', 'locale']) || !safeStrings(document.identity.collection, document.identity.canonicalKey, document.identity.locale) || typeof document.file !== 'string' || !hash(document.sha256)) throw invalid()
    const sort = `${document.identity.collection}\u0000${document.identity.canonicalKey}\u0000${document.identity.locale}\u0000${document.file}`
    const identity = `${document.identity.collection}\u0000${document.identity.canonicalKey}\u0000${document.identity.locale}`
    if (sort <= priorDocument || identities.has(identity)) throw invalid()
    priorDocument = sort; identities.add(identity)
  }
  let priorAsset = ''
  for (const asset of value.assets) {
    if (!record(asset) || !exact(asset, ['sha256', 'file', 'bytes', 'mediaType']) || !hash(asset.sha256) || typeof asset.file !== 'string' || !Number.isSafeInteger(asset.bytes) || (asset.bytes as number) < 0 || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(String(asset.mediaType)) || asset.sha256 <= priorAsset) throw invalid()
    priorAsset = asset.sha256
  }
  canonicalJsonBytes(value as JsonValue)
  return value as unknown as PortableManifestV1
}

export async function rebuildPortableManifest(args: {
  contract: ResolvedContentContractV1
  documents: Array<{ file: string; document: PortableDocumentV1; bytes: Uint8Array }>
  assets: Array<PortableAssetBlobV1 & { content: Uint8Array }>
}): Promise<PortableManifestV1> {
  const contract = assertResolvedContentContract(args.contract)
  if (args.documents.length > 100_000 || args.documents.length + args.assets.length + 2 > 200_000) throw portabilityError('LIMIT_EXCEEDED', 'portability.rebuildManifest', 'Portable file count exceeds the supported limit.')
  validatePortableReferences(args.documents.map(item => item.document), contract)
  await validatePortableAssets(args.documents.map(item => item.document), contract, args.assets)
  const documents = await Promise.all(args.documents.map(async item => ({
    identity: { collection: item.document.collection, canonicalKey: item.document.canonicalKey, locale: item.document.locale },
    file: item.file,
    sha256: await sha256Hex(item.bytes),
  })))
  documents.sort((left, right) => compare(left.identity.collection, right.identity.collection) || compare(left.identity.canonicalKey, right.identity.canonicalKey) || compare(left.identity.locale, right.identity.locale) || compare(left.file, right.file))
  const assets = [...args.assets].sort((left, right) => compare(left.sha256, right.sha256)).map(({ content: _, ...asset }) => asset)
  return assertPortableManifest({
    format: 'ginko-content-portable', version: 1,
    contract: { file: '.ginko/content-contract.json', sha256: await hashCanonicalJson(contract as unknown as JsonValue) },
    documents, assets,
  })
}

const invalid = () => portabilityError('DOCUMENT_INVALID', 'portability.parse', 'Portable manifest is invalid.')
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
const hash = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const safeStrings = (...values: unknown[]) => values.every(value => typeof value === 'string' && value.length > 0 && value === value.normalize('NFC'))
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0
