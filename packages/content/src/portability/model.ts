import type { JsonValue } from '../cms-contract/hash.js'
import type { PortableMediaType } from '../cms-contract/types.js'

export type JsonObject = { [key: string]: JsonValue }

export interface PortableBodyV1 {
  kind: 'mdc'
  source: string
}

export interface PortableDocumentV1 {
  format: 'ginko-content-document'
  version: 1
  collection: string
  canonicalKey: string
  locale: string
  slug: string
  parentCanonicalKey: string | null
  order: string | null
  shared: JsonObject
  localized: JsonObject
  body: PortableBodyV1 | null
  visibility: {
    navigation: boolean
    search: boolean
    sitemap: boolean
  }
}

export interface PortableReferenceV1 {
  collection: string
  canonicalKey: string
}

export type PortableAssetReferenceV1 =
  | {
      kind: 'local'
      path: `/ginko-assets/${string}`
      sha256: string
      bytes: number
      mediaType: PortableMediaType
      originalFilename: string | null
    }
  | { kind: 'external'; url: `https://${string}` }

export interface PortableAssetBlobV1 {
  sha256: string
  file: string
  bytes: number
  mediaType: PortableMediaType
}

export interface PortableManifestV1 {
  format: 'ginko-content-portable'
  version: 1
  contract: { file: '.ginko/content-contract.json'; sha256: string }
  documents: Array<{
    identity: { collection: string; canonicalKey: string; locale: string }
    file: string
    sha256: string
  }>
  assets: PortableAssetBlobV1[]
}

export interface PortableSemanticModelV1 {
  documents: PortableDocumentV1[]
  assets: PortableAssetBlobV1[]
}
