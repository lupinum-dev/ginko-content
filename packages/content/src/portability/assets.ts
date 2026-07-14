import { canonicalJsonBytes, type JsonValue } from '../cms-contract/hash.js'
import type {
  PortableComponentPolicyV1,
  PortableMediaType,
  ResolvedContentContractV1,
  ResolvedContentFieldV1,
} from '../cms-contract/types.js'
import { verifyPublicImageBytes } from '../cms-contract/asset-bytes.js'
import { renderMarkdown } from 'comark/render'
import { portabilityError } from './errors.js'
import { parsePortableMdc } from './mdc.js'
import type { JsonObject, PortableAssetBlobV1, PortableAssetReferenceV1, PortableDocumentV1 } from './model.js'

const extensions: Record<PortableMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

const mediaTypesByExtension: Record<string, PortableMediaType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

export interface PortableMdcAssetReferenceV1 {
  path: `/ginko-assets/${string}`
  sha256: string
  mediaType: PortableMediaType
}

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))

export function assertPortableAssetReference(value: unknown): PortableAssetReferenceV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidAsset()
  const input = value as Record<string, unknown>
  if (input.kind === 'external') {
    if (!exactKeys(input, ['kind', 'url']) || typeof input.url !== 'string' || input.url.length > 2048) throw invalidAsset()
    try {
      const url = new URL(input.url)
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw invalidAsset()
    } catch {
      throw invalidAsset()
    }
    return input as unknown as PortableAssetReferenceV1
  }
  if (input.kind !== 'local' || !exactKeys(input, ['kind', 'path', 'sha256', 'bytes', 'mediaType', 'originalFilename'])) throw invalidAsset()
  if (typeof input.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.sha256)) throw invalidAsset()
  if (typeof input.bytes !== 'number' || !Number.isSafeInteger(input.bytes) || input.bytes < 0) throw invalidAsset()
  if (typeof input.mediaType !== 'string' || !(input.mediaType in extensions)) throw portabilityError('ASSET_TYPE_UNSUPPORTED', 'portability.validateAssets', 'Portable asset media type is unsupported.')
  const expected = `/ginko-assets/${input.sha256}.${extensions[input.mediaType as PortableMediaType]}`
  if (input.path !== expected) throw invalidAsset()
  if (input.originalFilename !== null) {
    if (typeof input.originalFilename !== 'string' || input.originalFilename !== input.originalFilename.normalize('NFC') || hasFilenameControl(input.originalFilename) || new TextEncoder().encode(input.originalFilename).length > 255) throw invalidAsset()
  }
  return input as unknown as PortableAssetReferenceV1
}

const invalidAsset = () => portabilityError('DOCUMENT_INVALID', 'portability.validateAssets', 'Portable asset reference is invalid.')
const hasFilenameControl = (value: string) => [...value].some(character => {
  const code = character.codePointAt(0)!
  return character === '/' || character === '\\' || code <= 31 || code === 127
})

export function collectPortableAssetReferences(fields: ResolvedContentFieldV1[], value: JsonObject): PortableAssetReferenceV1[] {
  const output: PortableAssetReferenceV1[] = []
  for (const field of fields) {
    if (!(field.key in value)) continue
    visitField(field, value[field.key]!, output)
  }
  return output
}

function visitField(field: ResolvedContentFieldV1, value: JsonValue, output: PortableAssetReferenceV1[]): void {
  if (field.type === 'image' || field.type === 'file') {
    if (value !== null) output.push(assertPortableAssetReference(value))
  } else if (field.type === 'images') {
    if (!Array.isArray(value)) throw invalidAsset()
    output.push(...value.map(assertPortableAssetReference))
  } else if (field.fields && value && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (const item of value) if (item && typeof item === 'object' && !Array.isArray(item)) output.push(...collectPortableAssetReferences(field.fields, item))
    } else {
      output.push(...collectPortableAssetReferences(field.fields, value))
    }
  }
}

export function rewritePortableAssetReferences(
  fields: ResolvedContentFieldV1[],
  value: JsonObject,
  rewrite: (reference: PortableAssetReferenceV1) => PortableAssetReferenceV1,
): JsonObject {
  const output = structuredClone(value)
  for (const field of fields) if (field.key in output) output[field.key] = rewriteField(field, output[field.key]!, rewrite)
  canonicalJsonBytes(output)
  return output
}

export async function collectPortableMdcAssetReferences(
  source: string,
  policy: PortableComponentPolicyV1,
): Promise<PortableMdcAssetReferenceV1[]> {
  const ast = await parsePortableMdc(source, policy)
  const output: PortableMdcAssetReferenceV1[] = []
  visitMdcAssetSources(ast.nodes, policy, (reference) => {
    output.push(reference)
    return reference.path
  })
  return output
}

export async function rewritePortableMdcAssetReferences(
  source: string,
  policy: PortableComponentPolicyV1,
  rewrite: (reference: PortableMdcAssetReferenceV1) => string,
): Promise<string> {
  const ast = await parsePortableMdc(source, policy)
  visitMdcAssetSources(ast.nodes, policy, rewrite)
  const rewritten = await renderMarkdown({ nodes: ast.nodes as never, frontmatter: {}, meta: {} })
  const normalized = rewritten.replace(/\n+$/g, '')
  await parsePortableMdc(normalized, policy)
  return normalized
}

export async function validatePortableAssets(
  documents: PortableDocumentV1[],
  contract: ResolvedContentContractV1,
  assets: Array<PortableAssetBlobV1 & { content: Uint8Array }>,
): Promise<void> {
  const byHash = new Map<string, PortableAssetBlobV1 & { content: Uint8Array }>()
  for (const asset of assets) {
    if (byHash.has(asset.sha256)) throw portabilityError('ASSET_INTEGRITY_FAILED', 'portability.validateAssets', 'Portable asset identity is duplicated.')
    let verified
    try { verified = await verifyPublicImageBytes(asset.content, asset.mediaType) } catch { throw portabilityError('ASSET_TYPE_UNSUPPORTED', 'portability.validateAssets', 'Portable asset bytes are unsupported.') }
    const extension = extensions[asset.mediaType]
    if (verified.sha256 !== asset.sha256 || verified.bytes !== asset.bytes || asset.file !== `public/ginko-assets/${asset.sha256}.${extension}`) throw portabilityError('ASSET_INTEGRITY_FAILED', 'portability.validateAssets', 'Portable asset integrity does not match its index.')
    byHash.set(asset.sha256, asset)
  }
  const referenced = new Set<string>()
  for (const document of documents) {
    const collection = contract.collections[document.collection]
    if (!collection) continue
    for (const reference of collectPortableAssetReferences(collection.fields, { ...document.shared, ...document.localized })) {
      if (reference.kind === 'local') referenced.add(reference.sha256)
    }
    if (document.body) {
      for (const reference of await collectPortableMdcAssetReferences(
        document.body.source,
        collection.componentPolicy,
      )) {
        referenced.add(reference.sha256)
      }
    }
  }
  for (const sha256 of referenced) if (!byHash.has(sha256)) throw portabilityError('ASSET_MISSING', 'portability.validateAssets', 'Portable asset file is missing.')
  for (const sha256 of byHash.keys()) if (!referenced.has(sha256)) throw portabilityError('ASSET_INTEGRITY_FAILED', 'portability.validateAssets', 'Portable asset file is unreferenced.')
}

function visitMdcAssetSources(
  nodes: JsonValue[],
  policy: PortableComponentPolicyV1,
  visit: (reference: PortableMdcAssetReferenceV1) => string,
): void {
  for (const node of nodes) {
    if (!Array.isArray(node) || typeof node[0] !== 'string') continue
    const props = node[1] && typeof node[1] === 'object' && !Array.isArray(node[1]) ? node[1] as JsonObject : {}
    const sourceProp = node[0] === 'img' ? 'src' : policy.components[node[0]]?.media?.sourceProp
    const source = sourceProp ? props[sourceProp] : undefined
    if (sourceProp && typeof source === 'string') {
      const reference = portableMdcAssetReference(source)
      if (reference) props[sourceProp] = visit(reference)
    }
    visitMdcAssetSources(node.slice(2) as JsonValue[], policy, visit)
  }
}

function portableMdcAssetReference(value: string): PortableMdcAssetReferenceV1 | null {
  const match = /^\/ginko-assets\/([0-9a-f]{64})\.(png|jpg|gif|webp)$/.exec(value)
  if (!match) return null
  return {
    path: value as `/ginko-assets/${string}`,
    sha256: match[1]!,
    mediaType: mediaTypesByExtension[match[2]!]!,
  }
}

function rewriteField(field: ResolvedContentFieldV1, value: JsonValue, rewrite: (reference: PortableAssetReferenceV1) => PortableAssetReferenceV1): JsonValue {
  if (field.type === 'image' || field.type === 'file') return value === null ? null : rewrite(assertPortableAssetReference(value)) as unknown as JsonValue
  if (field.type === 'images') return (value as JsonValue[]).map(item => rewrite(assertPortableAssetReference(item)) as unknown as JsonValue)
  if (!field.fields || !value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => item && typeof item === 'object' && !Array.isArray(item) ? rewritePortableAssetReferences(field.fields!, item, rewrite) : item)
  return rewritePortableAssetReferences(field.fields, value, rewrite)
}
