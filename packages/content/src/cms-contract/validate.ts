import { canonicalJsonBytes, type JsonValue } from './hash.js'
import type {
  PortableComponentPolicy,
  PortableComponentPolicyV2,
  ResolvedContentContract,
  ResolvedContentContractV1,
  ResolvedContentContractV2,
  ResolvedContentFieldTypeV1,
  ResolvedContentFieldV1,
  ResolvedContentValidationV1,
} from './types.js'
import {
  canonicalizePortableComponentName,
  isReservedPortableComponentName,
  isValidPortableComponentName,
} from './render-policy.js'

const fieldTypes = new Set<ResolvedContentFieldTypeV1>([
  'text', 'textarea', 'richtext', 'slug', 'email', 'url', 'number', 'range', 'select',
  'multiselect', 'radio', 'checkbox', 'toggle', 'date', 'datetime', 'time', 'json',
  'object', 'array', 'blocks', 'relation', 'relations', 'image', 'images', 'icon',
  'code', 'color',
])
const mediaTypes = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`)
  }
  return value as Record<string, unknown>
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys)
  const unknown = Object.keys(value).find(key => !allowed.has(key))
  if (unknown) throw new Error(`${path} contains unknown key "${unknown}".`)
  const missing = keys.find(key => !Object.prototype.hasOwnProperty.call(value, key))
  if (missing) throw new Error(`${path} is missing key "${missing}".`)
}

function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a non-empty string.`)
}

function boolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`)
}

function nullableNumber(value: unknown, path: string): void {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error(`${path} must be a finite number or null.`)
  }
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`)
  for (const [index, item] of value.entries()) string(item, `${path}[${index}]`)
  if (new Set(value).size !== value.length) throw new Error(`${path} must not contain duplicates.`)
  return value as string[]
}

function nullableString(value: unknown, path: string): void {
  if (value !== null) string(value, path)
}

function validation(value: unknown, path: string): ResolvedContentValidationV1 {
  const input = record(value, path)
  string(input.kind, `${path}.kind`)
  if (input.kind === 'string') {
    exact(input, ['kind', 'minLength', 'maxLength', 'format'], path)
    nullableNumber(input.minLength, `${path}.minLength`)
    nullableNumber(input.maxLength, `${path}.maxLength`)
    if (input.format !== null && !['email', 'url', 'date', 'datetime', 'time'].includes(String(input.format))) throw new Error(`${path}.format is invalid.`)
  } else if (input.kind === 'number') {
    exact(input, ['kind', 'min', 'max', 'integer'], path)
    nullableNumber(input.min, `${path}.min`)
    nullableNumber(input.max, `${path}.max`)
    boolean(input.integer, `${path}.integer`)
  } else if (input.kind === 'boolean') {
    exact(input, ['kind'], path)
  } else if (input.kind === 'enum') {
    exact(input, ['kind', 'values'], path)
    stringArray(input.values, `${path}.values`)
  } else if (input.kind === 'array') {
    exact(input, ['kind', 'minItems', 'maxItems', 'element'], path)
    nullableNumber(input.minItems, `${path}.minItems`)
    nullableNumber(input.maxItems, `${path}.maxItems`)
    validation(input.element, `${path}.element`)
  } else if (input.kind === 'object') {
    exact(input, ['kind', 'fields'], path)
    for (const [key, child] of Object.entries(record(input.fields, `${path}.fields`))) validation(child, `${path}.fields.${key}`)
  } else if (input.kind === 'nullable') {
    exact(input, ['kind', 'inner'], path)
    validation(input.inner, `${path}.inner`)
  } else {
    throw new Error(`${path}.kind is invalid.`)
  }
  return input as unknown as ResolvedContentValidationV1
}

function field(value: unknown, path: string): ResolvedContentFieldV1 {
  const input = record(value, path)
  exact(input, [
    'key', 'type', 'role', 'required', 'localized', 'searchable', 'sortable', 'default',
    'options', 'relation', 'media', 'fields', 'validation', 'min', 'max', 'step', 'slugFrom',
    'language',
  ], path)
  string(input.key, `${path}.key`)
  if (!fieldTypes.has(input.type as ResolvedContentFieldTypeV1)) throw new Error(`${path}.type is invalid.`)
  if (input.role !== null && !['title', 'description', 'body'].includes(String(input.role))) throw new Error(`${path}.role is invalid.`)
  for (const key of ['required', 'localized', 'searchable', 'sortable'] as const) boolean(input[key], `${path}.${key}`)
  const defaultValue = record(input.default, `${path}.default`)
  if (defaultValue.present === false) exact(defaultValue, ['present'], `${path}.default`)
  else if (defaultValue.present === true) exact(defaultValue, ['present', 'value'], `${path}.default`)
  else throw new Error(`${path}.default.present must be a boolean.`)
  if (input.options !== null) stringArray(input.options, `${path}.options`)
  if (input.relation !== null) {
    const relation = record(input.relation, `${path}.relation`)
    exact(relation, ['collection', 'multiple'], `${path}.relation`)
    string(relation.collection, `${path}.relation.collection`)
    boolean(relation.multiple, `${path}.relation.multiple`)
  }
  if (input.media !== null) {
    const media = record(input.media, `${path}.media`)
    exact(media, ['mediaTypes', 'aspectRatio'], `${path}.media`)
    const types = stringArray(media.mediaTypes, `${path}.media.mediaTypes`)
    if (types.some(type => !mediaTypes.has(type))) throw new Error(`${path}.media.mediaTypes contains an unsupported type.`)
    nullableString(media.aspectRatio, `${path}.media.aspectRatio`)
  }
  if (input.fields !== null) {
    if (!Array.isArray(input.fields)) throw new Error(`${path}.fields must be an array or null.`)
    input.fields.forEach((child, index) => field(child, `${path}.fields[${index}]`))
  }
  if (input.validation !== null) validation(input.validation, `${path}.validation`)
  for (const key of ['min', 'max', 'step'] as const) nullableNumber(input[key], `${path}.${key}`)
  nullableString(input.slugFrom, `${path}.slugFrom`)
  nullableString(input.language, `${path}.language`)
  validateFieldPolicy(input as unknown as ResolvedContentFieldV1, path)
  return input as unknown as ResolvedContentFieldV1
}

function validateFieldPolicy(input: ResolvedContentFieldV1, path: string): void {
  if (input.relation && (!['relation', 'relations'].includes(input.type) || input.relation.multiple !== (input.type === 'relations'))) throw new Error(`${path} has invalid relation policy.`)
  if (input.media && !['image', 'images'].includes(input.type)) throw new Error(`${path} has invalid media policy.`)
  if (input.fields && !['object', 'array', 'blocks'].includes(input.type)) throw new Error(`${path} has invalid nested field policy.`)
  if (input.options && !['select', 'multiselect', 'radio'].includes(input.type)) throw new Error(`${path} has invalid options policy.`)
  if ((input.min !== null || input.max !== null || input.step !== null) && !['number', 'range'].includes(input.type)) throw new Error(`${path} has invalid numeric policy.`)
  if (input.slugFrom !== null && input.type !== 'slug') throw new Error(`${path} has invalid slug policy.`)
}

function componentPolicy(value: unknown, path: string, version: 1 | 2): PortableComponentPolicy {
  const input = record(value, path)
  exact(input, version === 1 ? ['components'] : ['version', 'components'], path)
  if (version === 2 && input.version !== 2) throw new Error(`${path}.version is invalid.`)
  const canonicalNames = new Set<string>()
  for (const [name, rawComponent] of Object.entries(record(input.components, `${path}.components`))) {
    const canonicalName = canonicalizePortableComponentName(name)
    if (
      !canonicalName ||
      name !== canonicalName ||
      !isValidPortableComponentName(canonicalName) ||
      isReservedPortableComponentName(canonicalName) ||
      ['__proto__', 'prototype', 'constructor'].includes(name.toLowerCase()) ||
      canonicalNames.has(canonicalName)
    ) throw new Error(`${path}.components.${name} conflicts after canonicalization.`)
    canonicalNames.add(canonicalName)
    const component = record(rawComponent, `${path}.components.${name}`)
    exact(component, version === 1
      ? ['kind', 'props', 'slots', 'media']
      : ['kind', 'props', 'slots', 'allowedParents', 'allowedChildren', 'media'], `${path}.components.${name}`)
    if (!['block', 'inline'].includes(String(component.kind))) throw new Error(`${path}.components.${name}.kind is invalid.`)
    for (const [propName, rawProp] of Object.entries(record(component.props, `${path}.components.${name}.props`))) {
      const prop = record(rawProp, `${path}.components.${name}.props.${propName}`)
      exact(prop, version === 1 ? ['type', 'required'] : ['types', 'required', 'allowedValues'], `${path}.components.${name}.props.${propName}`)
      if (version === 1) {
        if (!['string', 'number', 'boolean', 'json', 'asset'].includes(String(prop.type))) throw new Error(`${path}.components.${name}.props.${propName}.type is invalid.`)
      } else {
        const types = stringArray(prop.types, `${path}.components.${name}.props.${propName}.types`)
        const canonicalTypes = ['string', 'number', 'boolean', 'json', 'asset']
        if (types.length === 0 || types.some(type => !canonicalTypes.includes(type)) || new Set(types).size !== types.length) {
          throw new Error(`${path}.components.${name}.props.${propName}.types is invalid.`)
        }
        if (types.some((type, index) => canonicalTypes.indexOf(type) <= canonicalTypes.indexOf(types[index - 1] ?? ''))) {
          throw new Error(`${path}.components.${name}.props.${propName}.types is not canonical.`)
        }
        if (types.includes('asset') && types.length !== 1) throw new Error(`${path}.components.${name}.props.${propName}.asset type must be exclusive.`)
        if (prop.allowedValues !== null) {
          if (!Array.isArray(prop.allowedValues) || prop.allowedValues.length === 0) throw new Error(`${path}.components.${name}.props.${propName}.allowedValues is invalid.`)
          const allowed = prop.allowedValues
          const primitiveTypes = types.filter(type => ['string', 'number', 'boolean'].includes(type))
          const keys = new Set<string>()
          for (const [index, allowedValue] of allowed.entries()) {
            const valueType = typeof allowedValue
            if (!['string', 'number', 'boolean'].includes(valueType) || (valueType === 'number' && !Number.isFinite(allowedValue))) {
              throw new Error(`${path}.components.${name}.props.${propName}.allowedValues[${index}] is invalid.`)
            }
            if (!primitiveTypes.includes(valueType)) throw new Error(`${path}.components.${name}.props.${propName}.allowedValues is outside its types.`)
            const key = `${valueType}:${String(allowedValue)}`
            if (keys.has(key)) throw new Error(`${path}.components.${name}.props.${propName}.allowedValues has duplicates.`)
            keys.add(key)
          }
          if (primitiveTypes.some(type => !allowed.some(value => typeof value === type))) {
            throw new Error(`${path}.components.${name}.props.${propName}.allowedValues omits a declared primitive type.`)
          }
        }
        if (types.includes('asset') && prop.allowedValues !== null) throw new Error(`${path}.components.${name}.props.${propName}.asset values cannot be restricted.`)
      }
      boolean(prop.required, `${path}.components.${name}.props.${propName}.required`)
    }
    stringArray(component.slots, `${path}.components.${name}.slots`)
    if (version === 2) {
      for (const key of ['allowedParents', 'allowedChildren'] as const) {
        if (component[key] === null) continue
        const names = stringArray(component[key], `${path}.components.${name}.${key}`)
        if (new Set(names).size !== names.length) throw new Error(`${path}.components.${name}.${key} has duplicates.`)
      }
    }
    if (component.media !== null) {
      const media = record(component.media, `${path}.components.${name}.media`)
      exact(media, ['sourceProp', 'altProp', 'titleProp', 'filenameProp'], `${path}.components.${name}.media`)
      string(media.sourceProp, `${path}.components.${name}.media.sourceProp`)
      for (const key of ['altProp', 'titleProp', 'filenameProp'] as const) nullableString(media[key], `${path}.components.${name}.media.${key}`)
      const props = record(component.props, `${path}.components.${name}.props`)
      const source = record(props[media.sourceProp], `${path}.components.${name}.props.${media.sourceProp}`)
      if (
        (version === 1 && source.type !== 'asset') ||
        (version === 2 && (!Array.isArray(source.types) || source.types.length !== 1 || source.types[0] !== 'asset'))
      ) throw new Error(`${path}.components.${name}.media.sourceProp must reference an asset prop.`)
      if (version === 2) {
        for (const key of ['altProp', 'titleProp', 'filenameProp'] as const) {
          const propName = media[key]
          if (propName === null) continue
          if (typeof propName !== 'string') {
            throw new TypeError(`${path}.components.${name}.media.${key} is invalid.`)
          }
          const target = record(props[propName], `${path}.components.${name}.props.${propName}`)
          if (!Array.isArray(target.types) || !target.types.includes('string')) {
            throw new Error(`${path}.components.${name}.media.${key} must reference a string-capable prop.`)
          }
        }
      }
    }
  }
  if (version === 2) {
    for (const [name, rawComponent] of Object.entries(record(input.components, `${path}.components`))) {
      const component = record(rawComponent, `${path}.components.${name}`)
      for (const key of ['allowedParents', 'allowedChildren'] as const) {
        if (component[key] !== null) {
          for (const related of stringArray(component[key], `${path}.components.${name}.${key}`)) {
            if (!canonicalNames.has(related)) throw new Error(`${path}.components.${name}.${key} references unknown component "${related}".`)
          }
        }
      }
    }
  }
  return input as unknown as PortableComponentPolicy
}

/** Validate an untrusted value as the exact, closed V2 component policy without normalizing it. */
export function assertPortableComponentPolicyV2(value: unknown): PortableComponentPolicyV2 {
  canonicalJsonBytes(value as JsonValue)
  return componentPolicy(value, 'Component policy', 2) as PortableComponentPolicyV2
}

/** Validate an untrusted value as the exact, closed resolved Content contract. */
export function assertResolvedContentContract(value: unknown): ResolvedContentContract {
  canonicalJsonBytes(value as JsonValue)
  const input = record(value, 'Content contract')
  exact(input, ['format', 'version', 'defaultLocale', 'locales', 'localeFallbacks', 'collections'], 'Content contract')
  if (input.format !== 'ginko-content-contract' || (input.version !== 1 && input.version !== 2)) throw new Error('Content contract format or version is invalid.')
  const version = input.version
  string(input.defaultLocale, 'Content contract.defaultLocale')
  const locales = stringArray(input.locales, 'Content contract.locales')
  if (!locales.includes(input.defaultLocale)) throw new Error('Content contract default locale must be declared.')
  const knownLocales = new Set(locales)
  const fallbacks = record(input.localeFallbacks, 'Content contract.localeFallbacks')
  exact(fallbacks, locales, 'Content contract.localeFallbacks')
  for (const locale of locales) {
    const chain = stringArray(fallbacks[locale], `Content contract.localeFallbacks.${locale}`)
    if (chain.includes(locale) || chain.some(target => !knownLocales.has(target))) throw new Error(`Content contract fallback for "${locale}" is invalid.`)
  }
  assertAcyclicFallbacks(locales, fallbacks as Record<string, string[]>)

  const collections = record(input.collections, 'Content contract.collections')
  const collectionIds = new Set(Object.keys(collections))
  for (const [id, rawCollection] of Object.entries(collections)) {
    const path = `Content contract collection "${id}"`
    const collection = record(rawCollection, path)
    exact(collection, ['id', 'kind', 'structure', 'defaultLocale', 'locales', 'routing', 'fields', 'portable', 'componentPolicy'], path)
    if (collection.id !== id) throw new Error(`${path} id must match its key.`)
    if (!['page', 'data'].includes(String(collection.kind)) || !['flat', 'tree'].includes(String(collection.structure))) throw new Error(`${path} kind or structure is invalid.`)
    string(collection.defaultLocale, `${path}.defaultLocale`)
    const collectionLocales = stringArray(collection.locales, `${path}.locales`)
    if (!collectionLocales.includes(collection.defaultLocale) || collectionLocales.some(locale => !knownLocales.has(locale))) throw new Error(`${path} locale policy is invalid.`)
    const routing = record(collection.routing, `${path}.routing`)
    exact(routing, ['mode', 'pathPrefix', 'localizedPathPrefixes', 'localizedSingletonPaths', 'slugMode', 'rootSlug', 'singleton', 'allowMultipleRoots'], `${path}.routing`)
    if (!['route', 'none'].includes(String(routing.mode)) || !['shared', 'localized', 'stable', 'localizedStable'].includes(String(routing.slugMode))) throw new Error(`${path} routing policy is invalid.`)
    if (typeof routing.pathPrefix !== 'string') throw new Error(`${path}.routing.pathPrefix must be a string.`)
    nullableString(routing.rootSlug, `${path}.routing.rootSlug`)
    boolean(routing.singleton, `${path}.routing.singleton`)
    boolean(routing.allowMultipleRoots, `${path}.routing.allowMultipleRoots`)
    for (const key of ['localizedPathPrefixes', 'localizedSingletonPaths'] as const) {
      if (routing[key] === null) continue
      const routes = record(routing[key], `${path}.routing.${key}`)
      for (const [locale, route] of Object.entries(routes)) {
        if (!collectionLocales.includes(locale) || typeof route !== 'string') throw new Error(`${path}.routing.${key} is invalid.`)
      }
    }
    if (!Array.isArray(collection.fields)) throw new Error(`${path}.fields must be an array.`)
    const fields = collection.fields.map((candidate, index) => field(candidate, `${path}.fields[${index}]`))
    if (new Set(fields.map(candidate => candidate.key)).size !== fields.length) throw new Error(`${path} has duplicate fields.`)
    assertPortableFieldKeys(fields, path)
    const portable = record(collection.portable, `${path}.portable`)
    exact(portable, ['format', 'bodyField'], `${path}.portable`)
    if (!['mdc', 'yaml', 'json'].includes(String(portable.format))) throw new Error(`${path}.portable.format is invalid.`)
    nullableString(portable.bodyField, `${path}.portable.bodyField`)
    const bodyFields = fields.filter(candidate => candidate.role === 'body')
    if (collection.kind === 'page') {
      if (portable.format !== 'mdc' || bodyFields.length !== 1 || bodyFields[0]!.type !== 'richtext' || portable.bodyField !== bodyFields[0]!.key) throw new Error(`${path} page portability policy is invalid.`)
    } else if (!['yaml', 'json'].includes(String(portable.format)) || portable.bodyField !== null || bodyFields.length !== 0) {
      throw new Error(`${path} data portability policy is invalid.`)
    }
    componentPolicy(collection.componentPolicy, `${path}.componentPolicy`, version)
    for (const candidate of fields) visitRelations(candidate, collectionIds, path)
  }
  return value as ResolvedContentContract
}

export function assertResolvedContentContractV1(value: unknown): ResolvedContentContractV1 {
  const contract = assertResolvedContentContract(value)
  if (contract.version !== 1) throw new Error('Content contract version 1 is required.')
  return contract
}

export function assertResolvedContentContractV2(value: unknown): ResolvedContentContractV2 {
  const contract = assertResolvedContentContract(value)
  if (contract.version !== 2) throw new Error('Content contract version 2 is required.')
  return contract
}

const reservedPortableFields = new Set(['ginko', 'id', '_id', 'stableId', 'translationKey', 'path', '_path', 'route', 'ast', 'toc', 'searchText', 'provider'])

function assertPortableFieldKeys(fields: ResolvedContentFieldV1[], path: string): void {
  for (const candidate of fields) {
    if (reservedPortableFields.has(candidate.key)) throw new Error(`${path} field "${candidate.key}" is reserved.`)
    if (candidate.fields) {
      if (new Set(candidate.fields.map(field => field.key)).size !== candidate.fields.length) throw new Error(`${path} field "${candidate.key}" has duplicate nested fields.`)
      assertPortableFieldKeys(candidate.fields, `${path} field "${candidate.key}"`)
    }
  }
}

function visitRelations(field: ResolvedContentFieldV1, collectionIds: Set<string>, path: string): void {
  if (field.relation && !collectionIds.has(field.relation.collection)) throw new Error(`${path} field "${field.key}" targets an unknown collection.`)
  field.fields?.forEach(child => visitRelations(child, collectionIds, path))
}

function assertAcyclicFallbacks(locales: string[], fallbacks: Record<string, string[]>): void {
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (locale: string) => {
    if (visiting.has(locale)) throw new Error('Content contract locale fallbacks contain a cycle.')
    if (visited.has(locale)) return
    visiting.add(locale)
    fallbacks[locale]?.forEach(visit)
    visiting.delete(locale)
    visited.add(locale)
  }
  locales.forEach(visit)
}
