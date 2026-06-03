import { CONTENT_REFERENCE_PREFIX } from '../../types/reference'

const zodTypeNames: Record<string, string> = {
  array: 'ZodArray',
  branded: 'ZodBranded',
  catch: 'ZodCatch',
  default: 'ZodDefault',
  boolean: 'ZodBoolean',
  date: 'ZodDate',
  enum: 'ZodEnum',
  nullable: 'ZodNullable',
  number: 'ZodNumber',
  object: 'ZodObject',
  optional: 'ZodOptional',
  pipe: 'ZodEffects',
  string: 'ZodString',
  transform: 'ZodEffects'
}

export const getSchemaDef = (schema: any) => schema?._def || schema?.def

export const getSchemaTypeName = (schema: any) => {
  const def = getSchemaDef(schema)
  return def?.typeName || zodTypeNames[def?.type as string] || def?.type
}

export const unwrapSchema = (schema: any): any => {
  let current = schema
  while (['ZodOptional', 'ZodNullable', 'ZodDefault', 'ZodEffects', 'ZodBranded', 'ZodCatch'].includes(getSchemaTypeName(current))) {
    const def = getSchemaDef(current)
    current = def.innerType || def.schema || def.in || def.out || def.type
  }
  return current
}

export const getObjectShape = (schema: any): Record<string, any> => {
  const shape = getSchemaDef(schema)?.shape
  return typeof shape === 'function' ? shape() : (shape || schema?.shape || {})
}

export const getReferenceDescriptor = (schema: any): { collection?: string } | null => {
  const base = unwrapSchema(schema)
  if (getSchemaTypeName(base) !== 'ZodString') {
    return null
  }

  const description = typeof base.description === 'string' ? base.description : ''
  if (!description.startsWith(CONTENT_REFERENCE_PREFIX)) {
    return null
  }

  return {
    collection: description.slice(CONTENT_REFERENCE_PREFIX.length) || undefined
  }
}

const getArrayElement = (schema: any) => {
  const current = unwrapSchema(schema)
  if (getSchemaTypeName(current) !== 'ZodArray') {
    return null
  }
  const def = getSchemaDef(current)
  return def.element || def.type || null
}

const wildcardReferenceTarget = '*'

const getTopLevelReferenceDescriptor = (schema: any) => {
  const direct = getReferenceDescriptor(schema)
  if (direct) {
    return direct
  }

  const arrayElement = getArrayElement(schema)
  return arrayElement ? getReferenceDescriptor(arrayElement) : null
}

export const collectTopLevelReferenceFieldsByTarget = (
  schema: unknown
): Record<string, string[]> => {
  const current = unwrapSchema(schema)
  if (getSchemaTypeName(current) !== 'ZodObject') {
    return {}
  }

  const references: Record<string, string[]> = {}
  for (const [field, childSchema] of Object.entries(getObjectShape(current))) {
    const descriptor = getTopLevelReferenceDescriptor(childSchema)
    if (!descriptor) {
      continue
    }

    const target = descriptor.collection || wildcardReferenceTarget
    references[target] ||= []
    references[target].push(field)
  }

  return references
}

export const collectTopLevelReferenceFields = (
  schema: unknown,
  targetCollection?: string
): string[] => {
  const references = collectTopLevelReferenceFieldsByTarget(schema)
  if (!targetCollection) {
    return [...new Set(Object.values(references).flat())]
  }

  return [
    ...new Set([
      ...(references[targetCollection] || []),
      ...(references[wildcardReferenceTarget] || [])
    ])
  ]
}
