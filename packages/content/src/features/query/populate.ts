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
import { MAX_PUBLIC_POPULATE_REFERENCES } from '../../core/query/limits'
import type { ContentQueryContext, RuntimeContentConfig } from './context'
import { ensureCollectionName } from './handles'

const LOCALIZED_DOC_INTERNAL_FIELDS = [
  'id',
  'path',
  'file',
  'canonicalKey',
  'locale',
  'resolved'
] as const

const wildcardReferenceTarget = '*'
const POPULATE_CONCURRENCY = 8

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

type PopulateValueResolver = (
  target: ContentCollectionHandle | string,
  value: unknown
) => Promise<unknown>

const countPopulateReferences = (
  docs: ReadonlyArray<LocalizedDoc<ParsedContent>>,
  populate: PopulateSpec
) => {
  let count = 0
  for (const doc of docs) {
    for (const field of Object.keys(populate)) {
      const value = (doc as Record<string, unknown>)[field]
      const values = Array.isArray(value) ? value : [value]
      count += values.filter(item => typeof item === 'string' && item.length > 0).length
      if (count > MAX_PUBLIC_POPULATE_REFERENCES) {
        throw new TypeError(
          `Content population exceeds the maximum of ${MAX_PUBLIC_POPULATE_REFERENCES} references per result set.`
        )
      }
    }
  }
}

const createPopulateValueResolver = (
  context: ContentQueryContext,
  resolveReference: PopulateReferenceResolver,
  locale: string | undefined,
  fallback: LocaleFallback | undefined
): PopulateValueResolver => {
  const memo = new Map<string, Promise<unknown>>()
  const queue: Array<() => void> = []
  let active = 0

  const drain = () => {
    while (active < POPULATE_CONCURRENCY) {
      const run = queue.shift()
      if (!run) return
      active += 1
      run()
    }
  }

  const schedule = (task: () => Promise<unknown>) => new Promise<unknown>((resolve, reject) => {
    queue.push(() => {
      void Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          active -= 1
          drain()
        })
    })
    drain()
  })

  return (target, value) => {
    if (typeof value !== 'string' || !value) {
      return Promise.resolve(null)
    }

    const key = JSON.stringify([ensureCollectionName(target), value, locale, fallback])
    const cached = memo.get(key)
    if (cached) return cached

    const pending = schedule(() => resolveReference(context, target, {
      by: { ref: value },
      ...(locale ? { locale } : {}),
      ...(fallback !== undefined ? { fallback } : {})
    } as OneOptions<ContentCollectionHandle | string>))
    memo.set(key, pending)
    void pending.catch(() => memo.delete(key))
    return pending
  }
}

const populateOneDocument = async <T extends ParsedContent, P extends PopulateSpec>(
  doc: LocalizedDoc<T>,
  populate: P,
  resolveValue: PopulateValueResolver
): Promise<LocalizedDoc<PopulatedDocument<T, P>>> => {
  const populated: Record<string, unknown> = { ...doc }
  await Promise.all(Object.entries(populate).map(async ([field, target]) => {
    const value = (doc as Record<string, unknown>)[field]
    if (Array.isArray(value)) {
      const resolved = await Promise.all(value.map(item => resolveValue(target, item)))
      populated[field] = resolved.filter(Boolean)
      return
    }
    populated[field] = await resolveValue(target, value)
  }))

  return populated as LocalizedDoc<PopulatedDocument<T, P>>
}

export const populateDocuments = async <T extends ParsedContent, P extends PopulateSpec | undefined>(
  context: ContentQueryContext,
  resolveReference: PopulateReferenceResolver,
  docs: ReadonlyArray<LocalizedDoc<T>>,
  populate: P,
  locale: string | undefined,
  fallback: LocaleFallback | undefined
): Promise<Array<LocalizedDoc<PopulatedDocument<T, P>>>> => {
  if (!populate || !isRecord(populate)) {
    return [...docs] as Array<LocalizedDoc<PopulatedDocument<T, P>>>
  }

  countPopulateReferences(docs, populate)
  const resolveValue = createPopulateValueResolver(context, resolveReference, locale, fallback)
  return Promise.all(
    docs.map(doc => populateOneDocument(doc, populate, resolveValue))
  ) as Promise<Array<LocalizedDoc<PopulatedDocument<T, P>>>>
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

  countPopulateReferences([doc], populate)
  return populateOneDocument(
    doc,
    populate,
    createPopulateValueResolver(context, resolveReference, locale, fallback)
  ) as Promise<LocalizedDoc<PopulatedDocument<T, P>>>
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
