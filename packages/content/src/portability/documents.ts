import { assertResolvedContentContract } from '../cms-contract/validate.js'
import { canonicalJsonBytes, type JsonValue } from '../cms-contract/hash.js'
import type { ResolvedContentCollectionV1, ResolvedContentContractV1, ResolvedContentFieldV1 } from '../cms-contract/types.js'
import { assertPortableAssetReference } from './assets.js'
import { asPortabilityError, portabilityError } from './errors.js'
import { normalizePortableMdcSource, parsePortableMdc } from './mdc.js'
import { parsePortableJson } from './json.js'
import type { JsonObject, PortableDocumentV1, PortableReferenceV1 } from './model.js'
import { encodePortableIdentitySegment } from './segments.js'
import { parsePortableYaml, serializePortableYaml } from './yaml.js'

const metadataKeys = ['version', 'collection', 'canonicalKey', 'locale', 'slug', 'parentCanonicalKey', 'order', 'visibility']
const visibilityKeys = ['navigation', 'search', 'sitemap']
const documentKeys = ['format', 'version', 'collection', 'canonicalKey', 'locale', 'slug', 'parentCanonicalKey', 'order', 'shared', 'localized', 'body', 'visibility']

export async function parsePortableDocument(
  input: string | Uint8Array,
  contractValue: ResolvedContentContractV1,
  file: string | null = null,
): Promise<PortableDocumentV1> {
  try {
    const contract = resolvedContract(contractValue)
    const source = decodeText(input)
    if (new TextEncoder().encode(source).length > 2 * 1024 * 1024) throw portabilityError('LIMIT_EXCEEDED', 'portability.parse', 'Portable document exceeds 2 MiB.')
    const extension = file?.match(/\.([^.]+)$/)?.[1]?.toLowerCase()
    if (extension === 'json') return parseDataRoot(parsePortableJson(source), contract, 'json')
    if (extension === 'yml' || extension === 'yaml') return parseDataRoot(parsePortableYaml(source), contract, 'yaml')
    if (extension && !['md', 'mdc', 'markdown'].includes(extension)) throw invalidDocument()
    if (source.startsWith('---\n') || source.startsWith('---\r\n')) return parseMarkdown(source, contract)
    try {
      const json = parsePortableJson(source)
      if (isRecord(json) && 'ginko' in json && 'fields' in json) return parseDataRoot(json, contract, 'json')
    } catch {
      // The same unqualified source may still be a Markdown format error below.
    }
    throw invalidDocument()
  } catch (error) {
    throw asPortabilityError(error, 'DOCUMENT_INVALID', 'portability.parse', 'Portable document is invalid.')
  }
}

async function parseMarkdown(source: string, contract: ResolvedContentContractV1): Promise<PortableDocumentV1> {
  const normalized = source.replace(/\r\n?/g, '\n')
  const end = normalized.indexOf('\n---\n', 4)
  if (end < 0) throw invalidDocument()
  const root = parsePortableYaml(normalized.slice(4, end))
  if (!isRecord(root)) throw invalidDocument()
  const body = normalizePortableMdcSource(normalized.slice(end + 5))
  const rootRecord = root as Record<string, unknown>
  const metadata = parseMetadata(rootRecord.ginko)
  const collection = getCollection(contract, metadata.collection)
  if (collection.portable.format !== 'mdc' || collection.kind !== 'page') throw invalidDocument()
  const content: Record<string, unknown> = { ...rootRecord }
  delete content.ginko
  const fields = classifyFields(content, collection, true)
  if (collection.portable.bodyField && collection.portable.bodyField in content) throw invalidDocument()
  await parsePortableMdc(body, collection.componentPolicy)
  return validatePortableDocument({
    format: 'ginko-content-document', ...metadata,
    shared: fields.shared, localized: fields.localized,
    body: { kind: 'mdc', source: body },
  }, contract)
}

function parseDataRoot(value: unknown, contract: ResolvedContentContractV1, format: 'yaml' | 'json'): PortableDocumentV1 {
  if (!isRecord(value) || !exact(value, ['ginko', 'fields']) || !isRecord(value.fields)) throw invalidDocument()
  const metadata = parseMetadata(value.ginko)
  const collection = getCollection(contract, metadata.collection)
  if (collection.kind !== 'data' || collection.portable.format !== format) throw invalidDocument()
  const fields = classifyFields(value.fields, collection, false)
  return validatePortableDocument({
    format: 'ginko-content-document', ...metadata,
    shared: fields.shared, localized: fields.localized, body: null,
  }, contract)
}

function parseMetadata(value: unknown): Omit<PortableDocumentV1, 'format' | 'shared' | 'localized' | 'body'> {
  if (!isRecord(value) || !exact(value, metadataKeys) || value.version !== 1 || !isRecord(value.visibility) || !exact(value.visibility, visibilityKeys)) throw invalidDocument()
  return {
    version: 1,
    collection: string(value.collection),
    canonicalKey: string(value.canonicalKey),
    locale: string(value.locale),
    slug: string(value.slug, true),
    parentCanonicalKey: nullableString(value.parentCanonicalKey),
    order: nullableString(value.order),
    visibility: {
      navigation: boolean(value.visibility.navigation),
      search: boolean(value.visibility.search),
      sitemap: boolean(value.visibility.sitemap),
    },
  }
}

export function validatePortableDocument(value: unknown, contractValue: ResolvedContentContractV1): PortableDocumentV1 {
  const contract = resolvedContract(contractValue)
  if (!isRecord(value) || !exact(value, documentKeys) || value.format !== 'ginko-content-document' || value.version !== 1) throw invalidDocument()
  const document = value as unknown as PortableDocumentV1
  for (const identity of [document.collection, document.canonicalKey, document.locale, document.slug]) assertNfc(identity, document.slug === identity)
  if (document.parentCanonicalKey !== null) assertNfc(document.parentCanonicalKey)
  const collection = getCollection(contract, document.collection)
  if (!collection.locales.includes(document.locale)) throw invalidDocument()
  if (!isRecord(document.shared) || !isRecord(document.localized)) throw invalidDocument()
  validateClassifiedFields(document.shared, document.localized, collection)
  validateTopology(document, collection)
  if (collection.portable.format === 'mdc') {
    if (!document.body || document.body.kind !== 'mdc' || typeof document.body.source !== 'string') throw invalidDocument()
  } else if (document.body !== null) throw invalidDocument()
  canonicalJsonBytes(document as unknown as JsonValue)
  return document
}

export async function serializePortableDocument(documentValue: PortableDocumentV1, contractValue: ResolvedContentContractV1): Promise<string> {
  try {
    const contract = resolvedContract(contractValue)
    const document = validatePortableDocument(documentValue, contract)
    const collection = getCollection(contract, document.collection)
    const ginko = metadataObject(document)
    if (collection.portable.format === 'mdc') {
      await parsePortableMdc(document.body!.source, collection.componentPolicy)
      const fields: JsonObject = {}
      for (const field of collection.fields) {
        if (field.role === 'body') continue
        const source = field.localized ? document.localized : document.shared
        if (field.key in source) fields[field.key] = source[field.key]!
      }
      const yaml = serializePortableYaml({ ginko, ...fields }, ['ginko', ...collection.fields.filter(field => field.role !== 'body').map(field => field.key)]).trimEnd()
      const body = normalizePortableMdcSource(document.body!.source)
      return `---\n${yaml}\n---\n${body}\n`
    }
    const fields: JsonObject = {}
    for (const field of collection.fields) {
      const source = field.localized ? document.localized : document.shared
      if (field.key in source) fields[field.key] = source[field.key]!
    }
    const root = { ginko, fields } as unknown as JsonValue
    return collection.portable.format === 'json'
      ? `${new TextDecoder().decode(canonicalJsonBytes(root))}\n`
      : serializePortableYaml(root, ['ginko', 'fields'])
  } catch (error) {
    throw asPortabilityError(error, 'DOCUMENT_INVALID', 'portability.serialize', 'Portable document is invalid.')
  }
}

export function portableDocumentPath(document: PortableDocumentV1, contract: ResolvedContentContractV1): string {
  const collection = getCollection(contract, document.collection)
  const extension = collection.portable.format === 'mdc' ? 'md' : collection.portable.format === 'yaml' ? 'yml' : 'json'
  return `content/${encodePortableIdentitySegment(document.collection)}/${encodePortableIdentitySegment(document.canonicalKey)}/${encodePortableIdentitySegment(document.locale)}.${extension}`
}

function classifyFields(value: Record<string, unknown>, collection: ResolvedContentCollectionV1, markdown: boolean): { shared: JsonObject; localized: JsonObject } {
  const known = new Map(collection.fields.filter(field => !(markdown && field.role === 'body')).map(field => [field.key, field]))
  if (Object.keys(value).some(key => !known.has(key) || key === 'ginko')) throw invalidDocument()
  const shared: JsonObject = {}
  const localized: JsonObject = {}
  for (const field of known.values()) {
    if (!(field.key in value)) {
      if (field.required) throw invalidDocument()
      continue
    }
    const validated = validateFieldValue(field, value[field.key])
    ;(field.localized ? localized : shared)[field.key] = validated
  }
  return { shared, localized }
}

function validateClassifiedFields(shared: JsonObject, localized: JsonObject, collection: ResolvedContentCollectionV1): void {
  const all = new Set(collection.fields.filter(field => field.role !== 'body').map(field => field.key))
  if ([...Object.keys(shared), ...Object.keys(localized)].some(key => !all.has(key)) || Object.keys(shared).some(key => key in localized)) throw invalidDocument()
  for (const field of collection.fields) {
    if (field.role === 'body') continue
    const correct = field.localized ? localized : shared
    const wrong = field.localized ? shared : localized
    if (field.key in wrong || (field.required && !(field.key in correct))) throw invalidDocument()
    if (field.key in correct) validateFieldValue(field, correct[field.key])
  }
}

function validateFieldValue(field: ResolvedContentFieldV1, value: unknown): JsonValue {
  if (value === null) {
    if (field.required) throw invalidDocument()
    return null
  }
  const strings = new Set(['text', 'textarea', 'richtext', 'slug', 'email', 'url', 'select', 'radio', 'date', 'datetime', 'time', 'icon', 'code', 'color'])
  if (strings.has(field.type)) {
    if (typeof value !== 'string') throw invalidDocument()
    if (field.options && !field.options.includes(value)) throw invalidDocument()
    if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalidDocument()
    if (field.type === 'datetime' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw invalidDocument()
    if (field.type === 'time' && !/^\d{2}:\d{2}:\d{2}$/.test(value)) throw invalidDocument()
    return value
  }
  if (field.type === 'number' || field.type === 'range') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw invalidDocument()
    return value
  }
  if (field.type === 'checkbox' || field.type === 'toggle') {
    if (typeof value !== 'boolean') throw invalidDocument()
    return value
  }
  if (field.type === 'multiselect') {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || (field.options && !field.options.includes(item)))) throw invalidDocument()
    return value as string[]
  }
  if (field.type === 'relation') {
    const reference = validateReference(value)
    if (reference.collection !== field.relation?.collection) throw invalidDocument()
    return reference as unknown as JsonValue
  }
  if (field.type === 'relations') {
    if (!Array.isArray(value)) throw invalidDocument()
    const references = value.map(validateReference)
    if (references.some(reference => reference.collection !== field.relation?.collection)) throw invalidDocument()
    return references as unknown as JsonValue
  }
  if (field.type === 'image') return assertPortableAssetReference(value) as unknown as JsonValue
  if (field.type === 'images') {
    if (!Array.isArray(value)) throw invalidDocument()
    return value.map(assertPortableAssetReference) as unknown as JsonValue
  }
  if (field.type === 'object') {
    if (!isRecord(value) || !field.fields) throw invalidDocument()
    return validateNested(value, field.fields)
  }
  if (field.type === 'array' || field.type === 'blocks') {
    if (!Array.isArray(value)) throw invalidDocument()
    if (!field.fields) return validateJson(value)
    const fields = field.fields
    return value.map(item => !isRecord(item) ? (() => { throw invalidDocument() })() : validateNested(item, fields))
  }
  return validateJson(value)
}

function validateNested(value: Record<string, unknown>, fields: ResolvedContentFieldV1[]): JsonObject {
  const known = new Set(fields.map(field => field.key))
  if (Object.keys(value).some(key => !known.has(key))) throw invalidDocument()
  const output: JsonObject = {}
  for (const field of fields) {
    if (!(field.key in value)) {
      if (field.required) throw invalidDocument()
    } else output[field.key] = validateFieldValue(field, value[field.key])
  }
  return output
}

const validateJson = (value: unknown): JsonValue => { canonicalJsonBytes(value as JsonValue); return value as JsonValue }
function validateReference(value: unknown): PortableReferenceV1 {
  if (!isRecord(value) || !exact(value, ['collection', 'canonicalKey'])) throw invalidDocument()
  assertNfc(string(value.collection)); assertNfc(string(value.canonicalKey))
  return value as unknown as PortableReferenceV1
}

function validateTopology(document: PortableDocumentV1, collection: ResolvedContentCollectionV1): void {
  const route = collection.kind === 'page' && collection.routing.mode === 'route'
  if (!route) {
    if (document.slug !== '' || document.parentCanonicalKey !== null || document.order !== null || Object.values(document.visibility).some(Boolean)) throw invalidDocument()
    return
  }
  if (!document.slug || /[/?#]/.test(document.slug) || document.slug === '.' || document.slug === '..') throw invalidDocument()
  if (collection.routing.singleton) {
    if (document.parentCanonicalKey !== null || document.order !== null || (collection.routing.rootSlug !== null && document.slug !== collection.routing.rootSlug)) throw invalidDocument()
  } else if (collection.structure === 'flat') {
    if (document.parentCanonicalKey !== null || document.order !== null) throw invalidDocument()
  } else {
    if (document.order !== null && !/^[0-9A-F]{16}$/.test(document.order)) throw invalidDocument()
    if (!collection.routing.allowMultipleRoots && document.slug !== collection.routing.rootSlug && document.parentCanonicalKey === null) throw invalidDocument()
    if (document.slug === collection.routing.rootSlug && document.parentCanonicalKey !== null) throw invalidDocument()
  }
}

function metadataObject(document: PortableDocumentV1): JsonObject {
  return {
    version: 1,
    collection: document.collection,
    canonicalKey: document.canonicalKey,
    locale: document.locale,
    slug: document.slug,
    parentCanonicalKey: document.parentCanonicalKey,
    order: document.order,
    visibility: document.visibility,
  }
}

const decodeText = (value: string | Uint8Array) => {
  if (typeof value === 'string') return value
  try { return new TextDecoder('utf-8', { fatal: true }).decode(value) } catch { throw invalidDocument() }
}
const getCollection = (contract: ResolvedContentContractV1, id: string) => contract.collections[id] ?? (() => { throw invalidDocument() })()
const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
const string = (value: unknown, empty = false) => { if (typeof value !== 'string' || (!empty && !value)) throw invalidDocument(); return value }
const nullableString = (value: unknown) => value === null ? null : string(value)
const boolean = (value: unknown) => { if (typeof value !== 'boolean') throw invalidDocument(); return value }
const assertNfc = (value: string, empty = false) => { if ((!empty && !value) || value !== value.normalize('NFC') || /[\uD800-\uDFFF]/u.test(value)) throw invalidDocument() }
const invalidDocument = () => portabilityError('DOCUMENT_INVALID', 'portability.parse', 'Portable document is invalid.')
const resolvedContract = (value: ResolvedContentContractV1) => {
  try { return assertResolvedContentContract(value) } catch { throw portabilityError('CONTRACT_INVALID', 'portability.parse', 'Resolved Content contract is invalid.') }
}
