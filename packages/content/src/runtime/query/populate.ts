import type { ParsedContent } from '../../types/content'
import type { ContentCollectionHandle } from '../../types/config'
import type {
  LocaleFallback,
  LocalizedDoc,
  OneOptions,
  PopulateSpec,
  PopulatedDocument
} from '../../types/query'
import { collectTopLevelReferenceFieldsByTarget } from '../../core/references/schema'
import type { ContentQueryContext, RuntimeContentConfig } from './context'
import { ensureCollectionName } from './handles'

const LOCALIZED_DOC_INTERNAL_FIELDS = [
  '_id',
  '_path',
  '_file',
  '_canonicalKey',
  '_locale',
  '_resolvedLocale',
  '_requestedLocale',
  '_fallback',
  '_availableLocales',
  '_variantPaths',
  '_requestedPath',
  '_requestedRoute',
  '_requestedRef',
  '_extension'
] as const

const wildcardReferenceTarget = '*'

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const collectReferenceFieldsByTarget = (
  source: ContentCollectionHandle | string,
  sourceCollection: string,
  runtime: RuntimeContentConfig | undefined
) => {
  if (typeof source !== 'string') {
    return collectTopLevelReferenceFieldsByTarget((source as { schema?: unknown }).schema)
  }

  return runtime?.collections?.[sourceCollection]?.references || {}
}

const invertReferenceFields = (references: Record<string, string[]>) => {
  const fields = new Map<string, string[]>()
  for (const [target, targetFields] of Object.entries(references)) {
    for (const field of targetFields) {
      const targets = fields.get(field) || []
      targets.push(target)
      fields.set(field, targets)
    }
  }
  return fields
}

const createPopulateTargetMismatchError = (
  sourceCollection: string,
  field: string,
  expectedTargets: string[],
  actualTarget: string
) => new Error([
  `Cannot populate "${sourceCollection}.${field}" from "${actualTarget}".`,
  `Reference metadata declares "${sourceCollection}.${field}" points to ${expectedTargets.map(target => `"${target}"`).join(' or ')}.`,
  `Change populate.${field} to the declared target collection, or update ${sourceCollection}.schema relation metadata.`
].join(' '))

export const validatePopulateSpec = (
  source: ContentCollectionHandle | string,
  sourceCollection: string,
  runtime: RuntimeContentConfig | undefined,
  populate: PopulateSpec | undefined
) => {
  if (!populate || !isRecord(populate)) {
    return
  }

  const references = collectReferenceFieldsByTarget(source, sourceCollection, runtime)
  const fieldTargets = invertReferenceFields(references)
  if (!fieldTargets.size) {
    return
  }

  for (const [field, target] of Object.entries(populate)) {
    const declaredTargets = fieldTargets.get(field)
    if (!declaredTargets?.length) {
      continue
    }

    const actualTarget = ensureCollectionName(target)
    if (declaredTargets.includes(actualTarget) || declaredTargets.includes(wildcardReferenceTarget)) {
      continue
    }

    throw createPopulateTargetMismatchError(
      sourceCollection,
      field,
      declaredTargets.filter(target => target !== wildcardReferenceTarget),
      actualTarget
    )
  }
}

type PopulateReferenceResolver = (
  context: ContentQueryContext,
  target: ContentCollectionHandle | string,
  options: OneOptions<ContentCollectionHandle | string>
) => Promise<unknown>

const populateReferenceValue = async (
  context: ContentQueryContext,
  resolveReference: PopulateReferenceResolver,
  target: ContentCollectionHandle | string,
  value: unknown,
  locale: string | undefined,
  fallback: LocaleFallback | undefined
) => {
  if (typeof value !== 'string' || !value) {
    return null
  }

  return resolveReference(context, target, {
    by: { ref: value },
    ...(locale ? { locale } : {}),
    ...(fallback !== undefined ? { fallback } : {})
  } as OneOptions<ContentCollectionHandle | string>)
}

export const populateDocument = async <T extends ParsedContent, P extends PopulateSpec | undefined>(
  context: ContentQueryContext,
  resolveReference: PopulateReferenceResolver,
  doc: LocalizedDoc<T>,
  populate: P,
  locale: string | undefined,
  fallback: LocaleFallback | undefined
): Promise<LocalizedDoc<PopulatedDocument<T, P>>> => {
  if (!populate || !isRecord(populate)) {
    return doc as LocalizedDoc<PopulatedDocument<T, P>>
  }

  const populated: Record<string, unknown> = { ...doc }
  await Promise.all(Object.entries(populate).map(async ([field, target]) => {
    const value = (doc as Record<string, unknown>)[field]
    if (Array.isArray(value)) {
      const resolved = await Promise.all(value.map(item => populateReferenceValue(context, resolveReference, target, item, locale, fallback)))
      populated[field] = resolved.filter(Boolean)
      return
    }
    populated[field] = await populateReferenceValue(context, resolveReference, target, value, locale, fallback)
  }))

  return populated as LocalizedDoc<PopulatedDocument<T, P>>
}

export const selectWithPopulate = (
  select: ReadonlyArray<string> | undefined,
  populate: PopulateSpec | undefined
) => {
  if (!select) {
    return undefined
  }
  return [...new Set([
    ...select,
    ...LOCALIZED_DOC_INTERNAL_FIELDS,
    ...(populate && isRecord(populate) ? Object.keys(populate) : [])
  ])]
}
