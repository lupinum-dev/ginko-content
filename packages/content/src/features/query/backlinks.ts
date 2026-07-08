import type { ParsedContent } from '../../types/content'
import type { ContentCollectionHandle } from '../../types/config'
import type {
  BacklinkSource,
  BacklinksOptions,
  BacklinksResult,
  LocalizedDoc,
  ManyOptions,
  OneOptions,
  PopulateSpec,
  QueryWhere
} from '../../types/query'
import { normalizeReferenceValue } from '../../core/references/resolve'
import { collectTopLevelReferenceFields } from '../../core/references/schema'
import type { ContentQueryContext, RuntimeContentConfig } from './context'
import { ensureCollectionName } from './handles'

type OneResolver = <H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  handle: H,
  options: OneOptions<H>
) => Promise<LocalizedDoc<ParsedContent> | null>

type ManyResolver = <H extends ContentCollectionHandle | string, P extends PopulateSpec | undefined>(
  context: ContentQueryContext,
  handle: H,
  options: ManyOptions<H, P>
) => Promise<Array<LocalizedDoc<ParsedContent>>>

const backlinkSources = (value: BacklinkSource | ReadonlyArray<BacklinkSource>): BacklinkSource[] =>
  Array.isArray(value) ? [...value as BacklinkSource[]] : [value as BacklinkSource]

const isBacklinkFieldMap = (value: unknown): value is Record<string, ReadonlyArray<string>> => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const resolveExplicitBacklinkFields = (
  fields: BacklinksOptions['fields'],
  sourceName: string
) => {
  if (Array.isArray(fields)) {
    return fields.filter((field): field is string => typeof field === 'string' && field.length > 0)
  }

  if (!isBacklinkFieldMap(fields)) {
    return []
  }

  const sourceFields = fields?.[sourceName]
  return Array.isArray(sourceFields)
    ? sourceFields.filter((field): field is string => typeof field === 'string' && field.length > 0)
    : []
}

const inferBacklinkFields = (
  source: BacklinkSource,
  targetCollection: string,
  runtime: RuntimeContentConfig | undefined
) => {
  if (typeof source === 'string') {
    const references = runtime?.collections?.[source]?.references
    return [
      ...(references?.[targetCollection] || []),
      ...(references?.['*'] || [])
    ]
  }

  return collectTopLevelReferenceFields((source as { schema?: unknown }).schema, targetCollection)
}

const targetReferenceCandidates = (doc: LocalizedDoc<ParsedContent>) => {
  // Only documents with a real content identity (`canonicalKey`) are valid
  // reference targets. The shaped result always carries a default `path` of
  // '/', so path/unprefixedPath candidates are gated on `canonicalKey` to avoid
  // treating an identity-less document as referenceable. `ref` is the sole
  // user-facing alias (the explicit-id alias has been retired).
  const values = [
    (doc as { ref?: unknown }).ref,
    doc.canonicalKey,
    doc.canonicalKey ? doc.path : undefined,
    doc.canonicalKey ? doc.unprefixedPath : undefined
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .flatMap(value => [value, normalizeReferenceValue(value)])
    .filter(Boolean)

  return Array.from(new Set(values))
}

const backlinkWhere = (fields: string[], candidates: string[]): QueryWhere | undefined => {
  const clauses = fields.map(field => ({
    [field]: { $in: candidates }
  }))
  return clauses.length ? { $or: clauses } as QueryWhere : undefined
}

const createMissingBacklinkFieldsError = (
  sourceCollection: string,
  targetCollection: string
) => new Error(
  `Cannot infer backlink fields from "${sourceCollection}" to "${targetCollection}". `
  + `Declare fields.relation('${targetCollection}') / fields.relations('${targetCollection}') in ${sourceCollection}.schema, `
  + 'or pass fields explicitly.'
)

export async function resolveBacklinks<
  const Target extends ContentCollectionHandle | string,
  const Source extends BacklinkSource | ReadonlyArray<BacklinkSource>,
  P extends PopulateSpec | undefined = undefined
>(
  context: ContentQueryContext,
  one: OneResolver,
  many: ManyResolver,
  targetHandle: Target,
  options: BacklinksOptions<Target, Source, P>
): Promise<BacklinksResult<Source, P>> {
  const targetCollection = ensureCollectionName(targetHandle)
  const target = await one(context, targetHandle, {
    by: options.by,
    ...(options.locale ? { locale: options.locale } : {}),
    ...(options.fallback !== undefined ? { fallback: options.fallback } : {})
  } as OneOptions<Target>)

  if (!target) {
    return [] as BacklinksResult<Source, P>
  }

  const candidates = targetReferenceCandidates(target as LocalizedDoc<ParsedContent>)
  if (!candidates.length) {
    return [] as BacklinksResult<Source, P>
  }

  const sources = backlinkSources(options.from)
  const results = await Promise.all(sources.map(async (source) => {
    const sourceName = ensureCollectionName(source)
    const fields = [
      ...new Set([
        ...resolveExplicitBacklinkFields(options.fields, sourceName),
        ...inferBacklinkFields(source, targetCollection, context.runtime)
      ])
    ]
    if (!fields.length) {
      throw createMissingBacklinkFieldsError(sourceName, targetCollection)
    }
    const where = backlinkWhere(fields, candidates)
    if (!where) {
      return []
    }

    return await many(context, source, {
      where,
      sort: options.sort as never,
      limit: options.limit,
      skip: options.skip,
      ...(options.locale ? { locale: options.locale } : {}),
      ...(options.fallback !== undefined ? { fallback: options.fallback } : {}),
      select: options.select as ReadonlyArray<string> | undefined,
      populate: options.populate
    } as ManyOptions<typeof source, P>)
  }))

  return results.flat() as BacklinksResult<Source, P>
}
