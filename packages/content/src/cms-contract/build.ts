import type { ZodType } from 'zod'

import { getObjectShape, getReferenceDescriptor, getSchemaDef, getSchemaTypeName, unwrapSchema } from '../core/references/schema.js'
import type { ContentCmsFieldConfig, ContentCollectionConfig } from '../types/config.js'
import { getContentFieldMetadata, type ContentFieldMetadata } from '../types/fields.js'
import { canonicalJsonBytes, type JsonValue } from './hash.js'
import type {
  PortableComponentPolicyV1,
  PortableMediaType,
  ResolvedContentCollectionV1,
  ResolvedContentContractV1,
  ResolvedContentFieldTypeV1,
  ResolvedContentFieldV1,
  ResolvedContentValidationV1,
} from './types.js'

export const RESOLVED_CONTENT_CONTRACT_VERSION = 1 as const

export interface BuildResolvedContentContractInput {
  collections: Record<string, ContentCollectionConfig>
}

export interface BuildResolvedContentContractOptions {
  defaultLocale: string
  locales: string[]
  localeFallbacks?: Record<string, string[]>
  translatedSlugs?: boolean
  include?: string[]
  componentPolicy?: PortableComponentPolicyV1
}

export function buildResolvedContentContract(
  config: BuildResolvedContentContractInput,
  options: BuildResolvedContentContractOptions,
): ResolvedContentContractV1 {
  const locales = unique(options.locales)
  if (!locales.includes(options.defaultLocale)) throw new Error('The default locale must be declared in locales.')
  const localeFallbacks = resolveLocaleFallbacks(locales, options.defaultLocale, options.localeFallbacks)
  const componentPolicy = normalizeComponentPolicy(options.componentPolicy ?? { components: {} })
  const include = options.include ? new Set(options.include) : null
  const collections: Record<string, ResolvedContentCollectionV1> = {}

  for (const [id, collection] of Object.entries(config.collections)) {
    if (!include || include.has(id)) collections[id] = buildCollection(id, collection, options, localeFallbacks, componentPolicy)
  }
  validateRelationTargets(collections, new Set(Object.keys(config.collections)))

  const contract: ResolvedContentContractV1 = {
    format: 'ginko-content-contract',
    version: RESOLVED_CONTENT_CONTRACT_VERSION,
    defaultLocale: options.defaultLocale,
    locales,
    localeFallbacks,
    collections,
  }
  canonicalJsonBytes(contract as unknown as JsonValue)
  return contract
}

function buildCollection(
  id: string,
  collection: ContentCollectionConfig,
  options: BuildResolvedContentContractOptions,
  siteFallbacks: Record<string, string[]>,
  componentPolicy: PortableComponentPolicyV1,
): ResolvedContentCollectionV1 {
  const kind = collection.type ?? (isMarkdownCollection(collection) ? 'page' : 'data')
  const locales = collection.i18n === true
    ? unique(options.locales)
    : collection.i18n && typeof collection.i18n === 'object'
      ? unique(collection.i18n.locales)
      : [options.defaultLocale]
  const defaultLocale = collection.i18n && typeof collection.i18n === 'object'
    ? collection.i18n.defaultLocale
    : options.defaultLocale
  if (!locales.includes(defaultLocale)) throw new Error(`Collection "${id}" default locale must be allowed by that collection.`)
  for (const locale of locales) {
    if (!options.locales.includes(locale)) throw new Error(`Collection "${id}" uses undeclared locale "${locale}".`)
  }
  // Resolve this now even though the closed collection value does not duplicate
  // the site fallback map. Codec and query consumers filter by collection locales.
  for (const locale of locales) collectionFallbacks(locale, locales, defaultLocale, siteFallbacks)

  const singleton = collection.cms?.route?.singleton ?? isSingleRouteSource(collection)
  const localizedRoutes = localizedRouteMap(collection.route)
  const routeMode = collection.cms?.route?.mode ?? (kind === 'page' || collection.route ? 'route' : 'none')
  const pathPrefix = routeMode === 'none'
    ? ''
    : collection.cms?.route?.pathPrefix ?? routePrefix(id, collection, options.defaultLocale)
  const fields = buildFields(collection, locales.length > 1)
  validateFields(id, fields, kind)
  const bodyField = fields.find(field => field.role === 'body')?.key ?? null

  return {
    id,
    kind,
    structure: collection.cms?.type ?? 'flat',
    defaultLocale,
    locales,
    routing: {
      mode: routeMode,
      pathPrefix,
      localizedPathPrefixes: routeMode !== 'none' && localizedRoutes && !singleton ? localizedRoutes : null,
      localizedSingletonPaths: routeMode !== 'none' && localizedRoutes && singleton ? localizedRoutes : null,
      slugMode: collection.cms?.route?.slugMode ?? (options.translatedSlugs ? 'localized' : 'shared'),
      rootSlug: collection.cms?.route?.rootSlug ?? null,
      singleton,
      allowMultipleRoots: collection.cms?.route?.allowMultipleRoots ?? false,
    },
    fields,
    portable: kind === 'page'
      ? { format: 'mdc', bodyField }
      : { format: dataFormat(collection), bodyField: null },
    componentPolicy,
  }
}

function buildFields(collection: ContentCollectionConfig, localized: boolean): ResolvedContentFieldV1[] {
  const fields = new Map<string, ResolvedContentFieldV1>()
  if ((collection.type ?? (isMarkdownCollection(collection) ? 'page' : 'data')) === 'page') {
    fields.set('title', field({ key: 'title', type: 'text', role: 'title', required: true, localized }))
    fields.set('description', field({ key: 'description', type: 'textarea', role: 'description', localized }))
    fields.set('bodyMdc', field({ key: 'bodyMdc', type: 'richtext', role: 'body', localized }))
  }
  for (const candidate of fieldsFromSchema(collection.schema, localized)) fields.set(candidate.key, candidate)
  for (const [key, override] of Object.entries(collection.cms?.fields ?? {})) {
    if (override.type === 'divider' || override.type === 'section') continue
    fields.set(key, mergeField(fields.get(key), key, override, localized))
  }
  return [...fields.values()]
}

function fieldsFromSchema(schema: ZodType | undefined, localized: boolean): ResolvedContentFieldV1[] {
  return Object.entries(getObjectShape(schema))
    .filter(([key]) => !['title', 'description', 'body', 'bodyMdc'].includes(key))
    .map(([key, child]) => fieldFromSchema(key, child, localized))
}

function fieldFromSchema(key: string, schema: unknown, localized: boolean): ResolvedContentFieldV1 {
  const unwrapped = unwrapSchema(schema)
  const metadata = getContentFieldMetadata(schema) ?? getContentFieldMetadata(unwrapped)
  const required = !['ZodOptional', 'ZodNullable', 'ZodDefault'].includes(getSchemaTypeName(schema) ?? '')
  if (metadata) return fieldFromMetadata(key, metadata, schema, unwrapped, localized, required)
  const reference = getReferenceDescriptor(unwrapped)
  if (reference) return field({ key, type: 'relation', required, default: defaultFromSchema(schema), relation: { collection: reference.collection ?? '', multiple: false } })
  const typeName = getSchemaTypeName(unwrapped)
  if (typeName === 'ZodObject') return field({ key, type: 'object', required, localized, default: defaultFromSchema(schema), fields: nestedFields(unwrapped), validation: validationFromSchema(schema) })
  if (typeName === 'ZodArray') {
    const element = getSchemaDef(unwrapped)?.element
    const relation = getReferenceDescriptor(unwrapSchema(element))
    if (relation) return field({ key, type: 'relations', required, default: defaultFromSchema(schema), relation: { collection: relation.collection ?? '', multiple: true } })
    const children = getSchemaTypeName(unwrapSchema(element)) === 'ZodObject' ? nestedFields(element) : null
    return field({ key, type: children ? 'array' : 'json', required, localized, default: defaultFromSchema(schema), fields: children, validation: validationFromSchema(schema) })
  }
  if (typeName === 'ZodNumber') return field({ key, type: 'number', required, default: defaultFromSchema(schema), validation: validationFromSchema(schema) })
  if (typeName === 'ZodBoolean') return field({ key, type: 'toggle', required, default: defaultFromSchema(schema), validation: validationFromSchema(schema) })
  if (typeName === 'ZodDate') return field({ key, type: 'date', required, default: defaultFromSchema(schema), validation: validationFromSchema(schema) })
  return field({ key, type: typeName === 'ZodString' ? 'text' : 'json', required, localized, default: defaultFromSchema(schema), validation: validationFromSchema(schema) })
}

function fieldFromMetadata(key: string, metadata: ContentFieldMetadata, sourceSchema: unknown, schema: unknown, localized: boolean, required: boolean): ResolvedContentFieldV1 {
  const type = metadata.type === 'boolean' ? 'toggle' : metadata.type === 'asset' ? 'file' : metadata.type
  const nested = type === 'object'
    ? nestedFields(schema)
    : type === 'array' && getSchemaTypeName(unwrapSchema(getSchemaDef(schema)?.element)) === 'ZodObject'
      ? nestedFields(getSchemaDef(schema)?.element)
      : null
  return field({
    key,
    type,
    required: metadata.required ?? required,
    localized: metadata.localized ?? localized,
    default: defaultFromSchema(sourceSchema),
    options: metadata.options ?? null,
    relation: metadata.relation ? { collection: metadata.relation.collectionId, multiple: metadata.relation.multiple ?? type === 'relations' } : null,
    media: metadata.image || metadata.asset
      ? { mediaTypes: portableMediaTypes(metadata.image?.accept ?? metadata.asset?.accept), aspectRatio: metadata.image?.aspectRatio ?? null }
      : null,
    fields: nested,
    validation: validationFromSchema(sourceSchema, type),
    slugFrom: metadata.slugFrom ?? null,
  })
}

function nestedFields(schema: unknown): ResolvedContentFieldV1[] {
  return Object.entries(getObjectShape(unwrapSchema(schema)))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => fieldFromSchema(key, child, false))
}

function mergeField(existing: ResolvedContentFieldV1 | undefined, key: string, override: ContentCmsFieldConfig, localized: boolean): ResolvedContentFieldV1 {
  if (override.validation !== undefined) {
    throw new Error(`Field "${key}" uses the removed opaque CMS validation override; declare validation in its schema.`)
  }
  const type = override.type && override.type !== 'divider' && override.type !== 'section' ? override.type : existing?.type ?? 'text'
  const base = existing ?? field({ key, type, localized })
  return field({
    ...base,
    type,
    required: override.required ?? base.required,
    localized: override.localized ?? base.localized,
    searchable: override.searchable ?? base.searchable,
    sortable: override.sortable ?? base.sortable,
    default: Object.prototype.hasOwnProperty.call(override, 'defaultValue') ? { present: true, value: override.defaultValue as JsonValue } : base.default,
    options: override.options ?? base.options,
    relation: override.relation ? { collection: override.relation.collectionId, multiple: override.relation.multiple ?? type === 'relations' } : base.relation,
    fields: override.fields ? configuredFields(override.fields, false) : base.fields,
    min: override.min ?? base.min,
    max: override.max ?? base.max,
    step: override.step ?? base.step,
    slugFrom: override.slugFrom ?? base.slugFrom,
    language: override.language ?? base.language,
  })
}

function defaultFromSchema(schema: unknown): ResolvedContentFieldV1['default'] {
  let current = schema
  while (current) {
    const typeName = getSchemaTypeName(current)
    const definition = getSchemaDef(current)
    if (typeName === 'ZodDefault') return { present: true, value: definition?.defaultValue as JsonValue }
    if (!['ZodOptional', 'ZodNullable'].includes(typeName ?? '')) break
    current = definition?.innerType
  }
  return { present: false }
}

function validationFromSchema(schema: unknown, semanticType?: ResolvedContentFieldTypeV1): ResolvedContentValidationV1 | null {
  const typeName = getSchemaTypeName(schema)
  const definition = getSchemaDef(schema)
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') return validationFromSchema(definition?.innerType, semanticType)
  if (typeName === 'ZodNullable') {
    const inner = validationFromSchema(definition?.innerType, semanticType)
    return inner ? { kind: 'nullable', inner } : null
  }
  const value = schema as { minLength?: unknown; maxLength?: unknown; format?: unknown; minValue?: unknown; maxValue?: unknown; isInt?: unknown }
  if (semanticType && ['date', 'datetime', 'time'].includes(semanticType)) {
    return { kind: 'string', minLength: null, maxLength: null, format: semanticType as 'date' | 'datetime' | 'time' }
  }
  if (typeName === 'ZodString') {
    const format = ['email', 'url', 'date', 'datetime', 'time'].includes(String(value.format))
      ? value.format as 'email' | 'url' | 'date' | 'datetime' | 'time'
      : null
    return {
      kind: 'string',
      minLength: typeof value.minLength === 'number' ? value.minLength : null,
      maxLength: typeof value.maxLength === 'number' ? value.maxLength : null,
      format,
    }
  }
  if (typeName === 'ZodNumber') {
    return {
      kind: 'number',
      min: typeof value.minValue === 'number' ? value.minValue : null,
      max: typeof value.maxValue === 'number' ? value.maxValue : null,
      integer: value.isInt === true,
    }
  }
  if (typeName === 'ZodBoolean') return { kind: 'boolean' }
  if (typeName === 'ZodEnum') {
    return {
      kind: 'enum',
      values: Object.values((definition?.entries ?? {}) as Record<string, unknown>)
        .filter((entry): entry is string => typeof entry === 'string'),
    }
  }
  if (typeName === 'ZodArray') {
    const element = validationFromSchema(definition?.element)
    if (!element) return null
    const limits = arrayLimits(definition?.checks)
    return { kind: 'array', ...limits, element }
  }
  if (typeName === 'ZodObject') {
    const fields = Object.fromEntries(
      Object.entries(getObjectShape(schema))
        .map(([key, child]) => [key, validationFromSchema(child)])
        .filter((entry): entry is [string, ResolvedContentValidationV1] => entry[1] !== null),
    )
    return { kind: 'object', fields }
  }
  return null
}

function arrayLimits(checks: unknown): { minItems: number | null; maxItems: number | null } {
  let minItems: number | null = null
  let maxItems: number | null = null
  if (Array.isArray(checks)) {
    for (const check of checks) {
      const definition = (check as { _zod?: { def?: Record<string, unknown> }; def?: Record<string, unknown> })._zod?.def
        ?? (check as { def?: Record<string, unknown> }).def
      if (definition?.check === 'min_length' && typeof definition.minimum === 'number') minItems = definition.minimum
      if (definition?.check === 'max_length' && typeof definition.maximum === 'number') maxItems = definition.maximum
    }
  }
  return { minItems, maxItems }
}

function configuredFields(input: Record<string, ContentCmsFieldConfig> | ContentCmsFieldConfig[], localized: boolean): ResolvedContentFieldV1[] {
  const entries = Array.isArray(input) ? input.map((value, index) => [String(index), value] as const) : Object.entries(input)
  return entries.flatMap(([key, value]) => value.type === 'divider' || value.type === 'section' ? [] : [mergeField(undefined, key, value, localized)])
}

function field(input: Partial<ResolvedContentFieldV1> & { key: string; type: ResolvedContentFieldTypeV1 }): ResolvedContentFieldV1 {
  return {
    key: input.key,
    type: input.type,
    role: input.role ?? null,
    required: input.required ?? false,
    localized: input.localized ?? false,
    searchable: input.searchable ?? false,
    sortable: input.sortable ?? false,
    default: input.default ?? { present: false },
    options: input.options ?? null,
    relation: input.relation ?? null,
    media: input.media ?? null,
    fields: input.fields ?? null,
    validation: input.validation ?? null,
    min: input.min ?? null,
    max: input.max ?? null,
    step: input.step ?? null,
    slugFrom: input.slugFrom ?? null,
    language: input.language ?? null,
  }
}

function validateFields(collection: string, fields: ResolvedContentFieldV1[], kind: 'page' | 'data'): void {
  const bodies = fields.filter(candidate => candidate.role === 'body')
  if (bodies.length > 1) throw new Error(`Collection "${collection}" has more than one body field.`)
  if (kind === 'page' && (bodies.length !== 1 || bodies[0]?.type !== 'richtext')) throw new Error(`Page collection "${collection}" requires one richtext body field.`)
  if (kind === 'data' && bodies.length) throw new Error(`Data collection "${collection}" cannot have a body field.`)
  validateFieldLevel(collection, fields)
}

function validateFieldLevel(collection: string, fields: ResolvedContentFieldV1[]): void {
  const keys = new Set<string>()
  for (const candidate of fields) {
    if (keys.has(candidate.key)) throw new Error(`Collection "${collection}" has duplicate field "${candidate.key}".`)
    keys.add(candidate.key)
    if (candidate.relation && !['relation', 'relations'].includes(candidate.type)) throw new Error(`Field "${candidate.key}" has relation policy for type "${candidate.type}".`)
    if (candidate.relation && (!candidate.relation.collection || candidate.relation.multiple !== (candidate.type === 'relations'))) {
      throw new Error(`Field "${candidate.key}" has invalid relation cardinality or target.`)
    }
    if (candidate.media && !['image', 'images', 'file'].includes(candidate.type)) throw new Error(`Field "${candidate.key}" has media policy for type "${candidate.type}".`)
    if (candidate.fields && !['object', 'array', 'blocks'].includes(candidate.type)) throw new Error(`Field "${candidate.key}" has nested fields for type "${candidate.type}".`)
    if (candidate.options && !['select', 'multiselect', 'radio'].includes(candidate.type)) throw new Error(`Field "${candidate.key}" has options for type "${candidate.type}".`)
    if ((candidate.min !== null || candidate.max !== null || candidate.step !== null) && !['number', 'range'].includes(candidate.type)) {
      throw new Error(`Field "${candidate.key}" has numeric limits for type "${candidate.type}".`)
    }
    if (candidate.slugFrom !== null && candidate.type !== 'slug') throw new Error(`Field "${candidate.key}" has slugFrom for type "${candidate.type}".`)
    if (candidate.fields) validateFieldLevel(collection, candidate.fields)
  }
}

function validateRelationTargets(collections: Record<string, ResolvedContentCollectionV1>, collectionIds: Set<string>): void {
  const visit = (collection: string, fields: ResolvedContentFieldV1[]) => {
    for (const field of fields) {
      if (field.relation && !collectionIds.has(field.relation.collection)) {
        throw new Error(`Collection "${collection}" field "${field.key}" targets unknown collection "${field.relation.collection}".`)
      }
      if (field.fields) visit(collection, field.fields)
    }
  }
  for (const [collection, contract] of Object.entries(collections)) visit(collection, contract.fields)
}

function resolveLocaleFallbacks(locales: string[], defaultLocale: string, input: Record<string, string[]> = {}): Record<string, string[]> {
  const known = new Set(locales)
  const result: Record<string, string[]> = {}
  for (const locale of locales) {
    const chain = unique(input[locale] ?? [])
    if (chain.includes(locale)) throw new Error(`Locale fallback for "${locale}" contains itself.`)
    if (chain.some(target => !known.has(target))) throw new Error(`Locale fallback for "${locale}" contains an undeclared locale.`)
    if (locale !== defaultLocale && !chain.includes(defaultLocale)) chain.push(defaultLocale)
    result[locale] = chain
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (locale: string) => {
    if (visiting.has(locale)) throw new Error('Locale fallbacks contain a cycle.')
    if (visited.has(locale)) return
    visiting.add(locale)
    for (const target of result[locale] ?? []) visit(target)
    visiting.delete(locale)
    visited.add(locale)
  }
  for (const locale of locales) visit(locale)
  return result
}

function collectionFallbacks(locale: string, locales: string[], defaultLocale: string, siteFallbacks: Record<string, string[]>): string[] {
  const result = (siteFallbacks[locale] ?? []).filter(target => locales.includes(target))
  if (locale !== defaultLocale && !result.includes(defaultLocale)) result.push(defaultLocale)
  return result
}

function routePrefix(id: string, collection: ContentCollectionConfig, defaultLocale: string): string {
  if (!collection.route) return `/${id}`
  if (typeof collection.route === 'string') return collection.route
  return collection.route[defaultLocale] ?? Object.values(collection.route)[0] ?? `/${id}`
}

function localizedRouteMap(route: ContentCollectionConfig['route']): Record<string, string> | null {
  return route && typeof route === 'object' ? { ...route } : null
}

function isMarkdownCollection(collection: ContentCollectionConfig): boolean {
  if (collection.type === 'page' || collection.route) return true
  const sources = Array.isArray(collection.source) ? collection.source : [collection.source]
  return sources.some(source => typeof source === 'string' && /\.(md|mdc|markdown)(?:$|[*?{])/.test(source))
}

function isSingleRouteSource(collection: ContentCollectionConfig): boolean {
  const sources = Array.isArray(collection.source) ? collection.source : [collection.source]
  return Boolean(collection.route && sources.length === 1 && typeof sources[0] === 'string' && !/[{*?[\]]/.test(sources[0]))
}

function dataFormat(collection: ContentCollectionConfig): 'yaml' | 'json' {
  const sources = Array.isArray(collection.source) ? collection.source : [collection.source]
  const formats = unique(sources.flatMap((source) => {
    if (typeof source !== 'string') return []
    if (/\.json(?:$|[*?{])/.test(source)) return ['json' as const]
    if (/\.ya?ml(?:$|[*?{])/.test(source)) return ['yaml' as const]
    return []
  }))
  if (formats.length > 1) throw new Error('A data collection cannot mix JSON and YAML portable formats.')
  return formats[0] ?? 'yaml'
}

function portableMediaTypes(values: string[] | undefined): PortableMediaType[] {
  const allowed = new Set<PortableMediaType>(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
  return unique(values ?? []).filter((value): value is PortableMediaType => allowed.has(value as PortableMediaType))
}

function normalizeComponentPolicy(policy: PortableComponentPolicyV1): PortableComponentPolicyV1 {
  const components: PortableComponentPolicyV1['components'] = {}
  for (const [componentName, component] of Object.entries(policy.components)) {
    if (!componentName || eventLike(componentName) || /[:@]/.test(componentName)) {
      throw new Error(`Invalid portable component name "${componentName}".`)
    }
    const props: typeof component.props = {}
    for (const [propName, prop] of Object.entries(component.props)) {
      if (!propName || eventLike(propName) || /[:@]/.test(propName)) {
        throw new Error(`Invalid portable prop name "${componentName}.${propName}".`)
      }
      props[propName] = { type: prop.type, required: prop.required }
    }
    const slots = unique(component.slots)
    if (slots.some(slot => !slot || eventLike(slot) || /[:@]/.test(slot))) {
      throw new Error(`Component "${componentName}" has an invalid portable slot name.`)
    }
    const media = component.media
      ? {
          sourceProp: component.media.sourceProp,
          altProp: component.media.altProp,
          titleProp: component.media.titleProp,
          filenameProp: component.media.filenameProp,
        }
      : null
    if (media) {
      if (props[media.sourceProp]?.type !== 'asset') {
        throw new Error(`Component "${componentName}" media.sourceProp must name an asset prop.`)
      }
      for (const propName of [media.altProp, media.titleProp, media.filenameProp]) {
        if (propName !== null && props[propName]?.type !== 'string') {
          throw new Error(`Component "${componentName}" media presentation props must name string props.`)
        }
      }
    }
    components[componentName] = { kind: component.kind, props, slots, media }
  }
  return { components }
}

function eventLike(name: string): boolean {
  return /^on/i.test(name)
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
