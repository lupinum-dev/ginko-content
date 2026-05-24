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

export const collectTopLevelReferenceFields = (
  schema: unknown,
  targetCollection?: string
): string[] => {
  const current = unwrapSchema(schema)
  if (getSchemaTypeName(current) !== 'ZodObject') {
    return []
  }

  return Object.entries(getObjectShape(current))
    .filter(([, childSchema]) => {
      const direct = getReferenceDescriptor(childSchema)
      if (direct) {
        return !direct.collection || !targetCollection || direct.collection === targetCollection
      }

      const arrayElement = getArrayElement(childSchema)
      const arrayRef = arrayElement ? getReferenceDescriptor(arrayElement) : null
      return Boolean(arrayRef && (!arrayRef.collection || !targetCollection || arrayRef.collection === targetCollection))
    })
    .map(([field]) => field)
}
