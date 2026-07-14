import { canonicalJsonBytes, type JsonValue } from '../cms-contract/hash.js'
import type { PortableSemanticModelV1 } from './model.js'

export function normalizePortableModel(model: PortableSemanticModelV1): PortableSemanticModelV1 {
  const documents = structuredClone(model.documents).sort((left, right) => compare(left.collection, right.collection) || compare(left.canonicalKey, right.canonicalKey) || compare(left.locale, right.locale))
  const assets = structuredClone(model.assets).sort((left, right) => compare(left.sha256, right.sha256))
  canonicalJsonBytes({ documents, assets } as unknown as JsonValue)
  return { documents, assets }
}

export function portableModelsSemanticallyEqual(left: PortableSemanticModelV1, right: PortableSemanticModelV1): boolean {
  const decode = (model: PortableSemanticModelV1) => new TextDecoder().decode(canonicalJsonBytes(normalizePortableModel(model) as unknown as JsonValue))
  return decode(left) === decode(right)
}

const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0
