/**
 * `buildCmsContract` — deterministic normalization of a host's
 * `content.config.ts` output into the shape `@lupinum/ginko-cms` consumes.
 *
 * Per the refactor plan: the CMS used to *infer* labels, types, locales,
 * routing, and field shape from a content collection's loose config. That
 * inference produced misclassifications (data collections rendered as
 * route-backed, singletons treated as flat, fields losing media metadata).
 *
 * `buildCmsContract` instead produces a single normalized artifact. Anything
 * the CMS needs to know is recorded explicitly. The CMS is forbidden from
 * inferring on its own; it just reads this contract.
 *
 * This is a Gate 0 spike: the function is shaped end-to-end so the CMS can
 * import and call it, but the schema-introspection branches are intentionally
 * minimal. Gate 1 will fill them in against real fixtures.
 */

import type { ZodType } from 'zod'

import {
  getSchemaDef,
  getObjectShape,
  getReferenceDescriptor,
  getSchemaTypeName,
  unwrapSchema,
} from '../core/references/schema.js'
import type {
  ContentCmsCollectionConfig,
  ContentCmsFieldConfig,
  ContentCollectionConfig,
} from '../types/config.js'
import { getContentFieldMetadata, type ContentFieldMetadata } from '../types/fields.js'
import type {
  CmsCollectionContract,
  CmsCollectionRouting,
  CmsContract,
  CmsFieldContract,
  CmsSchemaArtifactRef,
  CmsSchemaCapabilities,
  CmsSchemaValidationArtifact,
  CmsSchemaValidationNode,
} from './types.js'

/** Stable contract version. Bump when the CMS-facing artifact shape changes. */
export const CMS_CONTRACT_VERSION = 'v1'

const IMPLICIT_PAGE_FIELDS = new Set(['title', 'description', 'body', 'bodyMdc'])

const SUPPORTED_TYPENAMES = new Set([
  'ZodObject',
  'ZodArray',
  'ZodString',
  'ZodNumber',
  'ZodBoolean',
  'ZodDate',
  'ZodEnum',
  'ZodOptional',
  'ZodNullable',
  'ZodDefault',
])

const WRAPPER_TYPENAMES = new Set(['ZodOptional', 'ZodNullable', 'ZodDefault'])

export class CmsContractSchemaUnsupportedError extends Error {
  constructor(
    readonly collectionSlug: string,
    readonly unsupported: CmsSchemaCapabilities['unsupported'],
  ) {
    super(
      [
        `CMS schema for collection "${collectionSlug}" contains unsupported Zod constructs.`,
        ...unsupported.map((item) => `- ${item.path}: ${item.feature} (${item.reason})`),
      ].join('\n'),
    )
    this.name = 'CmsContractSchemaUnsupportedError'
  }
}

export interface BuildCmsContractOptions {
  /** Site default locale, e.g. `'en'`. */
  defaultLocale: string
  /** All locale codes the site can serve. */
  locales: string[]
  /**
   * Global resolved translated-slug policy (VNEXT.md §22.2 step 11). This is
   * a site-wide, resolved-once input — collections do not carry their own
   * `translatedSlugs` flag.
   *
   * @default false
   */
  translatedSlugs?: boolean
  /** Optional include filter — when set, only listed collections are emitted. */
  include?: string[]
}

export interface BuildCmsContractInput {
  collections: Record<string, ContentCollectionConfig>
}

/**
 * Build a normalized CMS contract from a host's `content.config.ts` output.
 *
 * The function is deterministic: same input yields byte-identical output. The
 * CMS hashes the result to detect contract changes between deployments.
 */
export function buildCmsContract(
  config: BuildCmsContractInput,
  options: BuildCmsContractOptions,
): CmsContract {
  const include = options.include ? new Set(options.include) : null
  const collections: Record<string, CmsCollectionContract> = {}

  for (const [slug, collection] of Object.entries(config.collections)) {
    if (include && !include.has(slug)) continue
    collections[slug] = buildCollectionContract(slug, collection, options)
  }

  return {
    contractVersion: CMS_CONTRACT_VERSION,
    defaultLocale: options.defaultLocale,
    locales: [...options.locales],
    collections,
  }
}

function buildCollectionContract(
  slug: string,
  collection: ContentCollectionConfig,
  options: BuildCmsContractOptions,
): CmsCollectionContract {
  const cms = collection.cms ?? {}
  const locales = resolveLocales(collection, options)
  const defaultLocale = resolveDefaultLocale(collection, options)
  const isLocalized = locales.length > 1
  const routing = buildRouting(slug, collection, cms, options)
  const fields = buildFields(collection, cms, isLocalized)
  const schema = buildSchemaArtifactRef(slug, collection)

  const contract: CmsCollectionContract = {
    slug,
    label: cms.label ?? deriveLabel(slug),
    type: resolveCollectionType(slug, cms),
    icon: cms.icon ?? null,
    locales,
    defaultLocale,
    routing,
    fields,
  }
  if (schema) contract.schema = schema
  if (cms.settings !== undefined) contract.settings = cms.settings as Record<string, unknown>
  return contract
}

function resolveLocales(
  collection: ContentCollectionConfig,
  options: BuildCmsContractOptions,
): string[] {
  if (collection.i18n === true) return [...options.locales]
  if (collection.i18n && Array.isArray(collection.i18n.locales)) {
    return [...collection.i18n.locales]
  }
  return [options.defaultLocale]
}

function resolveDefaultLocale(
  collection: ContentCollectionConfig,
  options: BuildCmsContractOptions,
): string {
  if (collection.i18n && typeof collection.i18n === 'object') {
    return collection.i18n.defaultLocale ?? options.defaultLocale
  }
  return options.defaultLocale
}

function buildRouting(
  slug: string,
  collection: ContentCollectionConfig,
  cms: ContentCmsCollectionConfig,
  options: BuildCmsContractOptions,
): CmsCollectionRouting {
  const explicitMode = cms.route?.mode
  const localizedRoute = localizedRouteMap(collection.route)
  const pathPrefix =
    cms.route?.pathPrefix ?? deriveRoutePathPrefix(slug, collection, options.defaultLocale)
  const mode = explicitMode ?? (collection.sitemap === false && !pathPrefix ? 'none' : 'route')
  const singleton = cms.route?.singleton ?? isSingleRouteSource(collection)
  const routing: CmsCollectionRouting = {
    mode,
    pathPrefix: mode === 'none' ? '' : pathPrefix,
    slugMode: cms.route?.slugMode ?? (options.translatedSlugs ? 'localized' : 'shared'),
    rootSlug: cms.route?.rootSlug ?? null,
    singleton,
  }
  if (mode !== 'none' && localizedRoute) {
    if (routing.singleton) {
      routing.localizedSingletonPaths = localizedRoute
    } else {
      routing.localizedPathPrefixes = localizedRoute
    }
  }
  return routing
}

function deriveRoutePathPrefix(
  slug: string,
  collection: ContentCollectionConfig,
  defaultLocale: string,
): string {
  const route = collection.route
  if (!route) return `/${slug}`
  if (typeof route === 'string') return route
  const first = route[defaultLocale] ?? Object.values(route)[0]
  return first ?? `/${slug}`
}

function localizedRouteMap(
  route: ContentCollectionConfig['route'] | undefined,
): Record<string, string> | null {
  if (!route || typeof route !== 'object') return null
  return { ...route }
}

function isSingleRouteSource(collection: ContentCollectionConfig): boolean {
  if (!collection.route) return false
  const sources = Array.isArray(collection.source) ? collection.source : [collection.source]
  const routeSources = sources.filter((source): source is string => typeof source === 'string')
  return routeSources.length === 1 && !/[{*?[\]]/.test(routeSources[0] ?? '')
}

/**
 * Resolve a collection's structural type from explicit config only.
 *
 * The CMS no longer infers `tree` vs `flat` from the collection slug or routing
 * shape (the old `slug === 'docs'` / `rootSlug` heuristic misclassified). The
 * host must declare `cms.type`; when it is absent we default to `'flat'` and
 * emit a build-time warning so the omission is visible rather than silent.
 */
function resolveCollectionType(slug: string, cms: ContentCmsCollectionConfig): 'flat' | 'tree' {
  if (cms.type) return cms.type
  console.warn(
    `[ginko-content] Collection "${slug}" has no explicit \`cms.type\`; defaulting to 'flat'. ` +
      `Declare \`cms: { type: 'flat' | 'tree' }\` in the collection config to silence this warning.`,
  )
  return 'flat'
}

function deriveLabel(slug: string): string {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

function buildFields(
  collection: ContentCollectionConfig,
  cms: ContentCmsCollectionConfig,
  isLocalized: boolean,
): CmsFieldContract[] {
  const fields = new Map<string, CmsFieldContract>()

  for (const field of implicitPageFields(collection, isLocalized)) {
    fields.set(field.key, field)
  }

  for (const field of fieldsFromSchema(collection.schema, isLocalized)) {
    fields.set(field.key, field)
  }

  for (const [key, override] of Object.entries(cms.fields ?? {})) {
    const existing = fields.get(key)
    fields.set(key, mergeField(existing, key, override, isLocalized))
  }

  // Field order is the deterministic insertion order (implicit page fields,
  // then schema fields, then config-only fields). Display ordering is layout
  // policy the CMS owns via the opaque `editor` passthrough — ginko-content no
  // longer reads or reindexes a numeric `order`.
  return [...fields.values()]
}

function implicitPageFields(
  collection: ContentCollectionConfig,
  isLocalized: boolean,
): CmsFieldContract[] {
  const fields: CmsFieldContract[] = [
    field({ key: 'title', type: 'text', role: 'title', required: true, localized: isLocalized }),
    field({ key: 'description', type: 'textarea', role: 'description', localized: isLocalized }),
  ]
  if (isMarkdownCollection(collection)) {
    fields.push(field({ key: 'bodyMdc', type: 'richtext', role: 'body', localized: isLocalized }))
  }
  return fields
}

function isMarkdownCollection(collection: ContentCollectionConfig): boolean {
  if (collection.type === 'page' || collection.route) return true
  const source = collection.source
  if (!source) return false
  const sources = Array.isArray(source) ? source : [source]
  return sources.some((s) => typeof s === 'string' && /\.(md|mdc|markdown)$/.test(s))
}

function fieldsFromSchema(schema: ZodType | undefined, isLocalized: boolean): CmsFieldContract[] {
  if (!schema) return []
  const shape = getObjectShape(schema)
  if (!shape) return []
  const out: CmsFieldContract[] = []
  for (const [key, child] of Object.entries(shape)) {
    if (IMPLICIT_PAGE_FIELDS.has(key)) continue
    out.push(fieldFromSchema(key, child, isLocalized))
  }
  return out
}

function fieldFromSchema(key: string, schema: unknown, isLocalized: boolean): CmsFieldContract {
  const unwrapped = unwrapSchema(schema)
  const required = !isOptional(schema)
  const metadata = getContentFieldMetadata(schema) ?? getContentFieldMetadata(unwrapped)
  if (metadata) {
    return fieldFromMetadata(key, metadata, unwrapped, isLocalized, required)
  }
  const reference = getReferenceDescriptor(unwrapped)
  if (reference) {
    return field({
      key,
      type: 'relation',
      required,
      localized: false,
      relation: { collectionId: reference.collection ?? '', multiple: false },
    })
  }
  const typeName = getSchemaTypeName(unwrapped)
  if (typeName === 'ZodArray') {
    const element = getArrayElement(unwrapped)
    const elementReference = getReferenceDescriptor(element)
    if (elementReference) {
      return field({
        key,
        type: 'relations',
        required,
        localized: false,
        relation: { collectionId: elementReference.collection ?? '', multiple: true },
      })
    }
    const objectFields = fieldsFromArrayElement(element)
    if (!objectFields) {
      return field({
        key,
        type: 'json',
        required,
        localized: isLocalized,
      })
    }
    return field({
      key,
      type: 'array',
      required,
      localized: isLocalized,
      fields: objectFields,
    })
  }
  if (typeName === 'ZodObject') {
    return field({
      key,
      type: 'object',
      required,
      localized: isLocalized,
      fields: fieldsFromObjectSchema(unwrapped, false),
    })
  }
  if (typeName === 'ZodString')
    return field({ key, type: 'text', required, localized: isLocalized })
  if (typeName === 'ZodNumber') return field({ key, type: 'number', required, localized: false })
  if (typeName === 'ZodBoolean') return field({ key, type: 'toggle', required, localized: false })
  if (typeName === 'ZodDate') return field({ key, type: 'date', required, localized: false })
  return field({ key, type: 'json', required, localized: isLocalized })
}

function getArrayElement(schema: unknown): unknown {
  const def = getSchemaDef(schema)
  return def?.element ?? def?.type ?? null
}

function fieldsFromObjectSchema(schema: unknown, isLocalized: boolean): CmsFieldContract[] {
  return Object.entries(getObjectShape(unwrapSchema(schema)))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => fieldFromSchema(key, child, isLocalized))
}

function fieldFromMetadata(
  key: string,
  metadata: ContentFieldMetadata,
  schema: unknown,
  isLocalized: boolean,
  required: boolean,
): CmsFieldContract {
  const localized = metadata.localized ?? isLocalized
  const result: CmsFieldContract = field({
    key,
    type: metadataToContractType(metadata),
    required: metadata.required ?? required,
    localized,
    label: metadata.label ?? null,
    description: metadata.description ?? null,
    options: metadata.options ?? null,
    slugFrom: metadata.slugFrom ?? null,
  })
  if (metadata.image) {
    result.media = {
      ...(metadata.image.accept ? { accept: metadata.image.accept } : {}),
      aspectRatio: metadata.image.aspectRatio ?? null,
    }
  }
  if (metadata.asset) {
    result.media = {
      ...(metadata.asset.accept ? { accept: metadata.asset.accept } : {}),
      aspectRatio: null,
    }
  }
  if (metadata.relation) {
    result.relation = metadata.relation
  }
  if (result.type === 'object') {
    result.fields = fieldsFromObjectSchema(schema, false)
  }
  if (result.type === 'array') {
    const element = getArrayElement(unwrapSchema(schema))
    const objectFields = fieldsFromArrayElement(element)
    if (!objectFields) {
      result.type = 'json'
      result.fields = null
    } else {
      result.fields = objectFields
    }
  }
  return result
}

function fieldsFromArrayElement(element: unknown): CmsFieldContract[] | null {
  return element && getSchemaTypeName(unwrapSchema(element)) === 'ZodObject'
    ? fieldsFromObjectSchema(element, false)
    : null
}

function metadataToContractType(metadata: ContentFieldMetadata): CmsFieldContract['type'] {
  switch (metadata.type) {
    case 'boolean':
      return 'toggle'
    case 'asset':
      return 'file'
    default:
      return metadata.type as CmsFieldContract['type']
  }
}

function isOptional(schema: unknown): boolean {
  const typeName = getSchemaTypeName(schema)
  return typeName === 'ZodOptional' || typeName === 'ZodDefault' || typeName === 'ZodNullable'
}

function mergeField(
  existing: CmsFieldContract | undefined,
  key: string,
  override: ContentCmsFieldConfig,
  isLocalized: boolean,
): CmsFieldContract {
  const base = existing ?? field({ key, type: override.type ?? 'text', localized: isLocalized })
  return {
    ...base,
    ...(override.type !== undefined ? { type: override.type } : {}),
    ...(override.label !== undefined ? { label: override.label } : {}),
    ...(override.description !== undefined ? { description: override.description } : {}),
    ...(override.required !== undefined ? { required: override.required } : {}),
    ...(override.localized !== undefined ? { localized: override.localized } : {}),
    ...(override.searchable !== undefined ? { searchable: override.searchable } : {}),
    ...(override.sortable !== undefined ? { sortable: override.sortable } : {}),
    ...(override.defaultValue !== undefined ? { defaultValue: override.defaultValue } : {}),
    ...(override.validation !== undefined ? { validation: override.validation } : {}),
    ...(override.editor !== undefined ? { editor: override.editor } : {}),
    ...(override.options !== undefined ? { options: override.options } : {}),
    ...(override.relation !== undefined ? { relation: override.relation } : {}),
    ...(override.min !== undefined ? { min: override.min } : {}),
    ...(override.max !== undefined ? { max: override.max } : {}),
    ...(override.step !== undefined ? { step: override.step } : {}),
    ...(override.slugFrom !== undefined ? { slugFrom: override.slugFrom } : {}),
    ...(override.language !== undefined ? { language: override.language } : {}),
  }
}

function field(
  input: Partial<CmsFieldContract> & { key: string; type: CmsFieldContract['type'] },
): CmsFieldContract {
  return {
    key: input.key,
    type: input.type,
    role: input.role ?? null,
    label: input.label ?? null,
    description: input.description ?? null,
    required: input.required ?? false,
    localized: input.localized ?? false,
    searchable: input.searchable ?? false,
    sortable: input.sortable ?? false,
    defaultValue: input.defaultValue,
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

function stableJson(value: unknown): string {
  if (value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Build a schema artifact reference for a collection, if a Zod schema is set.
 *
 * Returns `undefined` when no schema is present, so collections without
 * publish validation don't carry an empty ref.
 */
function buildSchemaArtifactRef(
  slug: string,
  collection: ContentCollectionConfig,
): CmsSchemaArtifactRef | undefined {
  const schema = collection.schema
  if (!schema) return undefined
  const capabilities = inspectSchemaCapabilities(schema)
  if (capabilities.unsupported.length > 0) {
    throw new CmsContractSchemaUnsupportedError(slug, capabilities.unsupported)
  }
  const artifact = buildSchemaValidationArtifact(schema)
  const artifactBytes = stableJson(artifact)
  return {
    artifactId: `cms-schema:${slug}:${CMS_CONTRACT_VERSION}`,
    checksum: checksumArtifactBytes(artifactBytes),
    capabilities,
    artifact: artifactBytes,
  }
}

function buildSchemaValidationArtifact(schema: unknown): CmsSchemaValidationArtifact {
  return {
    version: CMS_CONTRACT_VERSION,
    root: schemaNode(schema),
  }
}

function schemaNode(schema: unknown): CmsSchemaValidationNode {
  const typeName = getSchemaTypeName(schema)
  if (typeName === 'ZodOptional') {
    return { kind: 'optional', inner: schemaNode(getSchemaDef(schema)?.innerType) }
  }
  if (typeName === 'ZodNullable') {
    return { kind: 'nullable', inner: schemaNode(getSchemaDef(schema)?.innerType) }
  }
  if (typeName === 'ZodDefault') {
    return {
      kind: 'default',
      inner: schemaNode(getSchemaDef(schema)?.innerType),
      value: getSchemaDef(schema)?.defaultValue,
    }
  }
  if (typeName === 'ZodObject') {
    const shape = getObjectShape(schema)
    return {
      kind: 'object',
      required: Object.entries(shape)
        .filter(([, child]) => !isOptional(child))
        .map(([key]) => key)
        .sort((left, right) => left.localeCompare(right)),
      shape: Object.fromEntries(
        Object.entries(shape)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, child]) => [key, schemaNode(child)]),
      ),
    }
  }
  if (typeName === 'ZodArray') {
    return { kind: 'array', element: schemaNode(getSchemaDef(schema)?.element) }
  }
  if (typeName === 'ZodString') {
    return { kind: 'string', checks: stringChecks(schema) }
  }
  if (typeName === 'ZodNumber') return { kind: 'number' }
  if (typeName === 'ZodBoolean') return { kind: 'boolean' }
  if (typeName === 'ZodDate') return { kind: 'date' }
  if (typeName === 'ZodEnum') {
    const entries = getSchemaDef(schema)?.entries
    return {
      kind: 'enum',
      values: Object.values((entries ?? {}) as Record<string, unknown>)
        .filter((value): value is string => typeof value === 'string')
        .sort((left, right) => left.localeCompare(right)),
    }
  }
  // See the matching comment in `walkSchema`: `fields.date()`/`fields.datetime()`
  // are a `z.preprocess` pipe over a refined string, not a raw `ZodDate` —
  // their metadata says the semantic type is still date/datetime.
  const metadata = getContentFieldMetadata(schema)
  if (metadata?.type === 'date' || metadata?.type === 'datetime') {
    return { kind: 'date' }
  }
  throw new Error(`Unsupported schema node ${typeName ?? '<unknown>'}.`)
}

type CmsStringCheck = NonNullable<
  Extract<CmsSchemaValidationNode, { kind: 'string' }>['checks']
>[number]

function stringChecks(schema: unknown): CmsStringCheck[] | undefined {
  const checks: Array<
    { kind: 'min'; value: number } | { kind: 'max'; value: number } | { kind: 'email' } | { kind: 'url' }
  > = []
  const value = schema as { minLength?: unknown; maxLength?: unknown; format?: unknown }
  if (typeof value.minLength === 'number') checks.push({ kind: 'min', value: value.minLength })
  if (typeof value.maxLength === 'number') checks.push({ kind: 'max', value: value.maxLength })
  if (value.format === 'email') checks.push({ kind: 'email' })
  if (value.format === 'url') checks.push({ kind: 'url' })
  return checks.length > 0 ? checks : undefined
}

function checksumArtifactBytes(source: string): string {
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function inspectSchemaCapabilities(schema: unknown): CmsSchemaCapabilities {
  const supports = new Set<CmsSchemaCapabilities['supports'][number]>()
  const unsupported: CmsSchemaCapabilities['unsupported'] = []
  walkSchema(schema, '', supports, unsupported)
  return {
    supports: [...supports],
    unsupported,
  }
}

function walkSchema(
  schema: unknown,
  path: string,
  supports: Set<CmsSchemaCapabilities['supports'][number]>,
  unsupported: CmsSchemaCapabilities['unsupported'],
): void {
  const typeName = getSchemaTypeName(schema)
  if (!typeName) return
  if (!SUPPORTED_TYPENAMES.has(typeName)) {
    // `fields.date()`/`fields.datetime()` normalize through a `z.preprocess`
    // pipe + a `.refine()`-checked string (VNEXT §11.2) — raw Zod constructs
    // this walker otherwise rejects (`ZodEffects`, custom refinements). The
    // Ginko field helper's own metadata is the source of truth for these two
    // fields: their semantic CMS type stays `date`/`datetime` even though the
    // runtime value is now a string, so trust the metadata instead of the
    // raw internals.
    const metadata = getContentFieldMetadata(schema)
    if (metadata?.type === 'date' || metadata?.type === 'datetime') {
      supports.add('date')
      return
    }
    unsupported.push({
      feature: typeName,
      path: path || '<root>',
      reason: `${typeName} is not yet supported by the validation artifact pipeline.`,
    })
    return
  }
  collectUnsupportedChecks(schema, path, unsupported)
  if (typeName === 'ZodOptional') supports.add('optional')
  if (typeName === 'ZodNullable') supports.add('nullable')
  if (typeName === 'ZodDefault') supports.add('default')
  if (WRAPPER_TYPENAMES.has(typeName)) {
    const inner = getSchemaDef(schema)?.innerType
    if (inner) walkSchema(inner, path, supports, unsupported)
    return
  }
  if (typeName === 'ZodObject') {
    supports.add('object')
    const shape = getObjectShape(schema)
    for (const [key, child] of Object.entries(shape)) {
      walkSchema(child, path ? `${path}.${key}` : key, supports, unsupported)
    }
  }
  if (typeName === 'ZodArray') {
    supports.add('array')
    const element = getSchemaDef(schema)?.element
    if (element) walkSchema(element, `${path || '<root>'}[]`, supports, unsupported)
  }
  if (typeName === 'ZodString') {
    supports.add('string')
    if (getReferenceDescriptor(schema)) supports.add('reference')
  }
  if (typeName === 'ZodNumber') supports.add('number')
  if (typeName === 'ZodBoolean') supports.add('boolean')
  if (typeName === 'ZodDate') supports.add('date')
  if (typeName === 'ZodEnum') supports.add('enum')
}

function collectUnsupportedChecks(
  schema: unknown,
  path: string,
  unsupported: CmsSchemaCapabilities['unsupported'],
): void {
  const checks = getSchemaDef(schema)?.checks
  if (!Array.isArray(checks)) return
  for (const check of checks) {
    const def = check?._zod?.def ?? check?.def
    if (!def || (def.check !== 'custom' && def.type !== 'custom')) continue
    const isAsync = def.fn?.constructor?.name === 'AsyncFunction'
    unsupported.push({
      feature: isAsync ? 'ZodAsyncRefinement' : 'ZodRefinement',
      path: path || '<root>',
      reason: 'Custom Zod refinements are not supported by the validation artifact pipeline.',
    })
  }
}
