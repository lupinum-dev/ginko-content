import { canonicalJsonBytes } from '../cms-contract/hash.js'
import type { ResolvedContentContractV1, ResolvedContentFieldV1 } from '../cms-contract/types.js'
import { portabilityError } from './errors.js'
import type { JsonObject, PortableDocumentV1, PortableReferenceV1 } from './model.js'

export function validatePortableReferences(documents: PortableDocumentV1[], contract: ResolvedContentContractV1): void {
  const variants = new Map<string, PortableDocumentV1>()
  const identities = new Map<string, Set<string>>()
  const shared = new Map<string, string>()
  for (const document of documents) {
    const variant = key(document.collection, document.canonicalKey, document.locale)
    if (variants.has(variant)) throw portabilityError('IDENTITY_CONFLICT', 'portability.validateReferences', 'Portable document identity is duplicated.')
    variants.set(variant, document)
    const identity = key(document.collection, document.canonicalKey)
    const encodedShared = new TextDecoder().decode(canonicalJsonBytes(document.shared))
    if (shared.has(identity) && shared.get(identity) !== encodedShared) throw portabilityError('SHARED_FIELD_DIVERGENCE', 'portability.validateReferences', 'Shared fields diverge between locale variants.')
    shared.set(identity, encodedShared)
    const locales = identities.get(identity) ?? new Set<string>()
    locales.add(document.locale)
    identities.set(identity, locales)
  }
  for (const document of documents) {
    const collection = contract.collections[document.collection]
    if (!collection) throw missing()
    if (document.parentCanonicalKey) {
      if (document.parentCanonicalKey === document.canonicalKey || !variants.has(key(document.collection, document.parentCanonicalKey, document.locale))) throw missing()
    }
    for (const reference of collectPortableReferences(collection.fields, { ...document.shared, ...document.localized })) {
      const target = contract.collections[reference.collection]
      if (!target || !identities.get(key(reference.collection, reference.canonicalKey))?.has(target.defaultLocale)) throw missing()
    }
  }
  for (const collection of Object.values(contract.collections).filter(value => value.structure === 'tree')) {
    for (const locale of collection.locales) assertAcyclic(documents.filter(document => document.collection === collection.id && document.locale === locale))
  }
}

export function collectPortableReferences(fields: ResolvedContentFieldV1[], value: JsonObject): PortableReferenceV1[] {
  const output: PortableReferenceV1[] = []
  for (const field of fields) {
    const candidate = value[field.key]
    if (candidate === undefined || candidate === null) continue
    if (field.type === 'relation') output.push(candidate as unknown as PortableReferenceV1)
    else if (field.type === 'relations') output.push(...candidate as unknown as PortableReferenceV1[])
    else if (field.fields && Array.isArray(candidate)) for (const item of candidate) if (item && typeof item === 'object' && !Array.isArray(item)) output.push(...collectPortableReferences(field.fields, item))
    else if (field.fields && typeof candidate === 'object' && !Array.isArray(candidate)) output.push(...collectPortableReferences(field.fields, candidate))
  }
  return output
}

function assertAcyclic(documents: PortableDocumentV1[]): void {
  const parents = new Map(documents.map(document => [document.canonicalKey, document.parentCanonicalKey]))
  for (const start of parents.keys()) {
    const seen = new Set<string>()
    let current: string | null | undefined = start
    while (current) {
      if (seen.has(current)) throw portabilityError('REFERENCE_CYCLE', 'portability.validateReferences', 'Portable parent references contain a cycle.')
      seen.add(current)
      current = parents.get(current)
    }
  }
}

const key = (...parts: string[]) => parts.join('\u0000')
const missing = () => portabilityError('REFERENCE_MISSING', 'portability.validateReferences', 'Portable reference target is missing.')
