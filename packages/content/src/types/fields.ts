import { z, type ZodTypeAny } from 'zod'

import { withContentReferenceMetadata } from './reference'

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * `Date.UTC` normalizes out-of-range components (month 13, day 32, ...), so a
 * calendar date is only real when re-reading the constructed UTC date yields
 * back the same year/month/day.
 */
const isValidCalendarDateString = (value: string): boolean => {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return false
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * Parse-boundary normalization for `fields.date()`: YAML frontmatter parsers
 * may still hand back a `Date` instance for a bare `date: 2026-01-01` scalar.
 * Convert that (and any other date-like input) to its `YYYY-MM-DD` text
 * before the calendar-validity refinement runs — the schema output is always
 * a string, never a `Date`.
 */
const toDateOnlyInput = (value: unknown): unknown => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString().slice(0, 10)
  }
  return value
}

const dateOnlySchema = z.preprocess(
  toDateOnlyInput,
  z.string().refine(isValidCalendarDateString, {
    message: 'must be a valid calendar date in YYYY-MM-DD form'
  })
)

/**
 * Parse-boundary normalization for `fields.datetime()`: accept a `Date`
 * instance or any date-like string/number and normalize to
 * `new Date(value).toISOString()`. The schema output is always a string,
 * never a `Date`.
 */
const toIsoDateTimeInput = (value: unknown): unknown => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString()
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toISOString()
  }
  return value
}

const datetimeSchema = z.preprocess(
  toIsoDateTimeInput,
  z.string().refine(value => !Number.isNaN(new Date(value).getTime()), {
    message: 'must be a valid date/time value convertible to a UTC ISO 8601 string'
  })
)

export const CONTENT_FIELD_METADATA_KEY = 'lupinum.ginko-content.field-metadata'

export const CONTENT_MANAGED_MEDIA_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const

export type ContentManagedMediaType = (typeof CONTENT_MANAGED_MEDIA_TYPES)[number]

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
    accept?: ContentManagedMediaType[]
  } | null
  asset?: {
    kind?: 'asset' | 'file'
    accept?: ContentManagedMediaType[]
  } | null
}

export type ContentFieldSchema<
  T extends ZodTypeAny = ZodTypeAny,
  TRequired extends ZodTypeAny = T,
> = T & {
  required(): ContentFieldSchema<TRequired, TRequired>
  label(value: string | Record<string, string> | null): ContentFieldSchema<T, TRequired>
  help(value: string | null): ContentFieldSchema<T, TRequired>
  localized(value?: boolean): ContentFieldSchema<T, TRequired>
  shared(): ContentFieldSchema<T, TRequired>
}

function readFieldMetadata (schema: unknown): ContentFieldMetadata | null {
  if (!schema || typeof schema !== 'object' || !('meta' in schema)) return null
  const readMeta = (schema as { meta?: () => Record<string, unknown> | undefined }).meta
  if (typeof readMeta !== 'function') return null
  const value = readMeta.call(schema)?.[CONTENT_FIELD_METADATA_KEY] as ContentFieldMetadata | undefined
  return value ? { ...value } : null
}

function writeFieldMetadata<T extends ZodTypeAny>(
  schema: T,
  metadata: ContentFieldMetadata,
): T {
  return schema.meta({ [CONTENT_FIELD_METADATA_KEY]: metadata }) as T
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
  Object.defineProperties(decorated, {
    required: {
      value: () => decorate(requiredSchema, cloneMetadata(metadata, { required: true })),
    },
    label: {
      value: (value: string | Record<string, string> | null) =>
        decorate(schema, cloneMetadata(metadata, { label: value }), requiredSchema),
    },
    help: {
      value: (value: string | null) =>
        decorate(schema, cloneMetadata(metadata, { description: value }), requiredSchema),
    },
    localized: {
      value: (value = true) =>
        decorate(schema, cloneMetadata(metadata, { localized: value }), requiredSchema),
    },
    shared: {
      value: () => decorate(schema, cloneMetadata(metadata, { localized: false }), requiredSchema),
    },
  })
  return decorated
}

function optionalField<T extends ZodTypeAny>(
  requiredSchema: T,
  metadata: ContentFieldMetadata,
): ContentFieldSchema<z.ZodOptional<T>, T> {
  const optionalSchema = requiredSchema.optional()
  const required = writeFieldMetadata(requiredSchema, cloneMetadata(metadata, { required: true }))
  return decorate(optionalSchema, cloneMetadata(metadata, { required: false }), required)
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
  slug: (options: { from?: string } = {}) =>
    optionalField(z.string(), { type: 'slug', slugFrom: options.from ?? null }),
  email: () => optionalField(z.string().email(), { type: 'email' }),
  url: () => optionalField(z.string().url(), { type: 'url' }),
  number: () => optionalField(z.number(), { type: 'number', localized: false }),
  boolean: () => optionalField(z.boolean(), { type: 'boolean', localized: false }),
  date: () => optionalField(dateOnlySchema, { type: 'date', localized: false }),
  datetime: () => optionalField(datetimeSchema, { type: 'datetime', localized: false }),
  select<const Values extends readonly [string, ...string[]]> (values: Values) {
    return optionalField(z.enum(values), { type: 'select', options: [...values] })
  },
  json: () => optionalField(z.unknown(), { type: 'json' }),
  icon: () => optionalField(z.string(), { type: 'icon' }),
  image (options: {
    aspectRatio?: string
    accept?: ContentManagedMediaType[]
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
  asset (options: { accept?: ContentManagedMediaType[] } = {}) {
    return optionalField(z.string(), {
      type: 'asset',
      localized: false,
      asset: {
        kind: 'asset',
        ...(options.accept ? { accept: options.accept } : {}),
      },
    })
  },
  file (options: { accept?: ContentManagedMediaType[] } = {}) {
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
    return optionalField(withContentReferenceMetadata(z.string(), collection), {
      type: 'relation',
      localized: false,
      relation: { collectionId: collection, multiple: false },
    })
  },
  relations (collection: string) {
    return optionalField(z.array(withContentReferenceMetadata(z.string(), collection)), {
      type: 'relations',
      localized: false,
      relation: { collectionId: collection, multiple: true },
    })
  },
}
