import { z, type ZodTypeAny } from 'zod'

import { CONTENT_REFERENCE_PREFIX } from './reference'

export const CONTENT_FIELD_METADATA_KEY = Symbol.for('lupinum.ginko-content.field-metadata')

export type ContentFieldMetadata = {
  type:
    | 'text'
    | 'textarea'
    | 'richtext'
    | 'slug'
    | 'email'
    | 'url'
    | 'number'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'select'
    | 'json'
    | 'object'
    | 'array'
    | 'relation'
    | 'relations'
    | 'image'
    | 'asset'
    | 'file'
    | 'icon'
  label?: string | Record<string, string> | null
  description?: string | null
  required?: boolean
  localized?: boolean
  options?: string[] | null
  relation?: {
    collectionId: string
    multiple?: boolean
  } | null
  slugFrom?: string | null
  image?: {
    aspectRatio?: string
    accept?: string[]
  } | null
  asset?: {
    kind?: 'asset' | 'file'
    accept?: string[]
  } | null
}

export type ContentFieldSchema<
  T extends ZodTypeAny = ZodTypeAny,
  TRequired extends ZodTypeAny = T,
> = T & {
  [CONTENT_FIELD_METADATA_KEY]?: ContentFieldMetadata
  required(): ContentFieldSchema<TRequired, TRequired>
  label(value: string | Record<string, string> | null): ContentFieldSchema<T, TRequired>
  help(value: string | null): ContentFieldSchema<T, TRequired>
  localized(value?: boolean): ContentFieldSchema<T, TRequired>
  shared(): ContentFieldSchema<T, TRequired>
}

function readFieldMetadata (schema: unknown): ContentFieldMetadata | null {
  const value = (schema as { [CONTENT_FIELD_METADATA_KEY]?: ContentFieldMetadata } | null)?.[
    CONTENT_FIELD_METADATA_KEY
  ]
  return value ? { ...value } : null
}

function writeFieldMetadata<T extends ZodTypeAny>(
  schema: T,
  metadata: ContentFieldMetadata,
): ContentFieldSchema<T, T> {
  Object.defineProperty(schema, CONTENT_FIELD_METADATA_KEY, {
    configurable: true,
    enumerable: false,
    value: metadata,
    writable: true,
  })
  return schema as ContentFieldSchema<T>
}

function cloneMetadata (metadata: ContentFieldMetadata, patch: Partial<ContentFieldMetadata>) {
  return { ...metadata, ...patch }
}

function decorate<T extends ZodTypeAny, TRequired extends ZodTypeAny = T>(
  schema: T,
  metadata: ContentFieldMetadata,
  requiredSchema: TRequired = schema as unknown as TRequired,
): ContentFieldSchema<T, TRequired> {
  const decorated = writeFieldMetadata(schema, metadata) as unknown as ContentFieldSchema<T, TRequired>
  decorated.required = () => decorate(requiredSchema, cloneMetadata(metadata, { required: true })) as ContentFieldSchema<TRequired, TRequired>
  decorated.label = (value) =>
    decorate(schema, cloneMetadata(metadata, { label: value }), requiredSchema) as ContentFieldSchema<T, TRequired>
  decorated.help = (value) =>
    decorate(schema, cloneMetadata(metadata, { description: value }), requiredSchema) as ContentFieldSchema<T, TRequired>
  decorated.localized = (value = true) =>
    decorate(schema, cloneMetadata(metadata, { localized: value }), requiredSchema) as ContentFieldSchema<T, TRequired>
  decorated.shared = () => decorate(schema, cloneMetadata(metadata, { localized: false }), requiredSchema) as ContentFieldSchema<T, TRequired>
  return decorated
}

function optionalField<T extends ZodTypeAny>(
  requiredSchema: T,
  metadata: ContentFieldMetadata,
): ContentFieldSchema<z.ZodOptional<T>, T> {
  const optionalSchema = requiredSchema.optional()
  writeFieldMetadata(requiredSchema, cloneMetadata(metadata, { required: true }))
  return decorate(optionalSchema, cloneMetadata(metadata, { required: false }), requiredSchema)
}

function textLike (type: ContentFieldMetadata['type']) {
  return optionalField(z.string(), { type })
}

function getZodType (schema: ZodTypeAny | undefined): string | undefined {
  const definition = schema?._def as { type?: string; typeName?: string } | undefined
  return typeof definition?.type === 'string'
    ? definition.type
    : typeof definition?.typeName === 'string'
      ? definition.typeName.replace(/^Zod/, '').toLowerCase()
      : undefined
}

function requiredArrayItem<Item extends ZodTypeAny> (item: Item): ZodTypeAny {
  if (!readFieldMetadata(item)) return item

  let current: ZodTypeAny = item
  while (current) {
    const type = getZodType(current)
    if (type !== 'optional' && type !== 'nullable' && type !== 'default' && type !== 'catch') {
      return current
    }
    const innerType = (current._def as { innerType?: ZodTypeAny }).innerType
    if (!innerType) return current
    current = innerType
  }

  return item
}

export function getContentFieldMetadata (schema: unknown): ContentFieldMetadata | null {
  return readFieldMetadata(schema)
}

export function isContentFieldSchema (schema: unknown): schema is ContentFieldSchema {
  return getContentFieldMetadata(schema) !== null
}

export const fields = {
  object<const Shape extends z.ZodRawShape> (shape: Shape) {
    return decorate(z.object(shape), { type: 'object', required: true })
  },
  array<Item extends ZodTypeAny> (item: Item) {
    const metadata = readFieldMetadata(item)
    const itemSchema = requiredArrayItem(item)
    const type = metadata?.type === 'relation' ? 'relations' : 'array'
    const relation =
      metadata?.type === 'relation' && metadata.relation
        ? { ...metadata.relation, multiple: true }
        : metadata?.type === 'relations'
          ? metadata.relation
          : null
    return optionalField(z.array(itemSchema), {
      type,
      ...(relation ? { relation } : {}),
    })
  },
  text: () => textLike('text'),
  textarea: () => textLike('textarea'),
  richtext: () => textLike('richtext'),
  markdown: () => textLike('richtext'),
  slug: (options: { from?: string } = {}) =>
    optionalField(z.string(), { type: 'slug', slugFrom: options.from ?? null }),
  email: () => optionalField(z.string().email(), { type: 'email' }),
  url: () => optionalField(z.string().url(), { type: 'url' }),
  number: () => optionalField(z.number(), { type: 'number', localized: false }),
  boolean: () => optionalField(z.boolean(), { type: 'boolean', localized: false }),
  toggle: () => optionalField(z.boolean(), { type: 'boolean', localized: false }),
  date: () => optionalField(z.coerce.date(), { type: 'date', localized: false }),
  datetime: () => optionalField(z.coerce.date(), { type: 'datetime', localized: false }),
  select<const Values extends readonly [string, ...string[]]> (values: Values) {
    return optionalField(z.enum(values), { type: 'select', options: [...values] })
  },
  enum<const Values extends readonly [string, ...string[]]> (values: Values) {
    return fields.select(values)
  },
  json: () => optionalField(z.unknown(), { type: 'json' }),
  icon: () => optionalField(z.string(), { type: 'icon' }),
  image (options: {
    aspectRatio?: string
    accept?: string[]
  } = {}) {
    return optionalField(z.string(), {
      type: 'image',
      localized: false,
      image: {
        ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}),
        ...(options.accept ? { accept: options.accept } : {}),
      },
    })
  },
  asset (options: { accept?: string[] } = {}) {
    return optionalField(z.string(), {
      type: 'asset',
      localized: false,
      asset: {
        kind: 'asset',
        ...(options.accept ? { accept: options.accept } : {}),
      },
    })
  },
  file (options: { accept?: string[] } = {}) {
    return optionalField(z.string(), {
      type: 'file',
      localized: false,
      asset: {
        kind: 'file',
        ...(options.accept ? { accept: options.accept } : {}),
      },
    })
  },
  relation (collection: string) {
    return optionalField(z.string().describe(`${CONTENT_REFERENCE_PREFIX}${collection}`), {
      type: 'relation',
      localized: false,
      relation: { collectionId: collection, multiple: false },
    })
  },
  relations (collection: string) {
    return optionalField(z.array(z.string().describe(`${CONTENT_REFERENCE_PREFIX}${collection}`)), {
      type: 'relations',
      localized: false,
      relation: { collectionId: collection, multiple: true },
    })
  },
}

export const image = fields.image
export const asset = fields.asset
export const file = fields.file
export const relation = fields.relation
export const relations = fields.relations
export const richtext = fields.richtext
export const text = fields.text
