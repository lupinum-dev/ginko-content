import type { ParsedContent } from '../types/content'
import type { ContentCollectionConfig } from '../types/config'
import { buildReferenceTargets, normalizeReferenceValue } from '../core/references/resolve'
import { getObjectShape, getReferenceDescriptor, getSchemaDef, getSchemaTypeName, unwrapSchema } from '../core/references/schema'
import { collectTranslatedSlugValidationIssues } from '../features/localization/translated-slugs'
import { ContentError, type ContentErrorCode } from '../core/errors'
import { fail, ok, type Result } from '../core/result'

/**
 * Graph- and document-level validators.
 *
 * Every function returns `Result<T, ContentError>` — expected failures carry a
 * specific `ContentErrorCode` so boundaries can decide how to react (404 vs
 * 500, warn vs fail-the-build). Nothing in this file throws; the boundary at
 * `storage/content.ts` and `integrations/nitro/ingest.ts` unwraps and throws
 * when the caller cannot handle a failure.
 */

const hasSafeParse = (schema: unknown): schema is { safeParse: (input: unknown) => { success: true } | { success: false, error: { issues?: Array<{ path?: Array<string | number>, message?: string }> } } } => {
  return Boolean(schema) && typeof (schema as { safeParse?: unknown }).safeParse === 'function'
}

const getCollectionConfig = (collectionName?: string, collections: Record<string, ContentCollectionConfig> = {}) => {
  if (!collectionName) {
    return undefined
  }

  return collections?.[collectionName]
}

/**
 * Build a `ContentError` with a consistent "Invalid content in <file>: <reason>"
 * message format.
 */
export function createContentError (
  code: ContentErrorCode,
  file: string,
  reason: string,
  details?: string,
  extraContext?: Record<string, unknown>
): ContentError {
  return new ContentError(
    code,
    `Invalid content in ${file}${details ? ` (${details})` : ''}: ${reason}`,
    { file, reason, ...(details ? { details } : {}), ...(extraContext || {}) }
  )
}

const collectReferenceIssues = (
  schema: any,
  value: unknown,
  resolveReference: (value: string, collection?: string) => boolean,
  issues: string[],
  path: Array<string | number> = []
) => {
  const current = unwrapSchema(schema)
  if (!current || typeof value === 'undefined' || value === null) {
    return
  }

  const ref = getReferenceDescriptor(current)
  if (ref) {
    if (typeof value !== 'string') {
      issues.push(`${path.join('.') || 'document'}: expected a string reference`)
      return
    }

    if (!resolveReference(value, ref.collection)) {
      issues.push(`${path.join('.') || 'document'}: unresolved reference "${value}"${ref.collection ? ` in collection "${ref.collection}"` : ''}`)
    }
    return
  }

  if (getSchemaTypeName(current) === 'ZodArray' && Array.isArray(value)) {
    const def = getSchemaDef(current)
    value.forEach((item, index) => collectReferenceIssues(def.element || def.type, item, resolveReference, issues, [...path, index]))
    return
  }

  if (getSchemaTypeName(current) === 'ZodObject' && typeof value === 'object') {
    const shape = getObjectShape(current)
    for (const [key, childSchema] of Object.entries(shape)) {
      collectReferenceIssues(childSchema, (value as Record<string, unknown>)[key], resolveReference, issues, [...path, key])
    }
  }
}

const collectDerivedReferenceIssues = (
  references: Record<string, string[]> | undefined,
  value: Record<string, unknown>,
  resolveReference: (value: string, collection?: string) => boolean,
  issues: string[]
) => {
  if (!references) {
    return
  }

  for (const [collection, fields] of Object.entries(references)) {
    for (const field of fields) {
      const fieldValue = value[field]
      const values = Array.isArray(fieldValue) ? fieldValue : [fieldValue]
      for (const item of values) {
        if (typeof item === 'undefined' || item === null) {
          continue
        }
        if (typeof item !== 'string') {
          issues.push(`${field}: expected a string reference`)
          continue
        }
        if (!resolveReference(item, collection === '*' ? undefined : collection)) {
          issues.push(`${field}: unresolved reference "${item}"${collection !== '*' ? ` in collection "${collection}"` : ''}`)
        }
      }
    }
  }
}

const internalDocumentFields = new Set([
  'id',
  'file',
  'path',
  'type',
  'collection',
  'canonicalKey',
  'partial',
  'draft',
  'dir',
  'locale',
  'navigationFile',
  'resolved',
  'body'
])

const toUserContentDocument = (document: ParsedContent) => {
  const userDocument: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(document)) {
    if (!internalDocumentFields.has(key)) {
      userDocument[key] = value
    }
  }
  return userDocument
}

const validateNavigationDocument = (document: ParsedContent): Result<void, ContentError> => {
  if (!document.navigationFile) {
    return ok(undefined)
  }

  const invalidFields: string[] = []
  if (typeof document.title !== 'undefined' && typeof document.title !== 'string') {
    invalidFields.push('title must be a string')
  }
  if (typeof document.order !== 'undefined' && typeof document.order !== 'number') {
    invalidFields.push('order must be a number')
  }
  if (typeof document.icon !== 'undefined' && typeof document.icon !== 'string' && document.icon !== false) {
    invalidFields.push('icon must be a string or false')
  }
  if (typeof document.hidden !== 'undefined' && typeof document.hidden !== 'boolean') {
    invalidFields.push('hidden must be a boolean')
  }
  if (typeof document.navigation !== 'undefined' && typeof document.navigation !== 'boolean' && typeof document.navigation !== 'object') {
    invalidFields.push('navigation must be false or an object')
  }
  if (typeof document.badge !== 'undefined' && typeof document.badge !== 'string' && typeof document.badge !== 'object') {
    invalidFields.push('badge must be a string or an object')
  }

  if (invalidFields.length) {
    return fail(createContentError(
      'INVALID_NAVIGATION_YAML',
      document.file?.path || document.id,
      'malformed .navigation.yml',
      invalidFields.join('; ')
    ))
  }

  return ok(undefined)
}

export const getCanonicalContentId = (document: ParsedContent, locales: string[] = []) => {
  if (typeof document.canonicalKey === 'string' && document.canonicalKey.length) {
    return document.canonicalKey
  }

  const file = (document.file?.path || '').replace(/^\/+/, '')
  const parts = file.split('/').filter(Boolean)
  const normalized = parts[0] && locales.includes(parts[0]) ? parts.slice(1) : parts
  return normalized.join('/').replace(/\.[^.]+$/, '')
}

/**
 * Validate a single document against its collection schema.
 *
 * - Non-strict collections: schema errors log `console.warn(...)` and the
 *   original document passes through.
 * - Strict collections (default): schema errors produce a `SCHEMA_VALIDATION_FAILED`
 *   failure.
 *
 * Also chains into `validateNavigationDocument` for `navigationFile: true` files,
 * which can fail with `INVALID_NAVIGATION_YAML`.
 */
export const validateCollectionDocument = (
  document: ParsedContent,
  collections: Record<string, ContentCollectionConfig> = {}
): Result<ParsedContent, ContentError> => {
  const navigationResult = validateNavigationDocument(document)
  if (!navigationResult.ok) {
    return navigationResult
  }

  if (!document.collection) {
    return ok(document)
  }

  const collection = getCollectionConfig(document.collection, collections)
  const schema = collection?.schema
  if (!hasSafeParse(schema)) {
    return ok(document)
  }

  const parsed = schema.safeParse(toUserContentDocument(document))
  if (parsed.success) {
    return ok({
      ...document,
      ...(parsed as { data: ParsedContent }).data
    })
  }

  const details = parsed.error.issues?.map((issue) => {
    const path = issue.path?.length ? issue.path.join('.') : 'document'
    return `${path}: ${issue.message}`
  }).join('; ')

  const message = `Invalid content in ${document.file?.path || document.id}${details ? ` (${details})` : ''}`
  if (collection?.strict === false) {
    console.warn(message)
    return ok(document)
  }

  return fail(new ContentError(
    'SCHEMA_VALIDATION_FAILED',
    message,
    {
      file: document.file?.path || document.id,
      collection: document.collection,
      ...(details ? { details } : {})
    }
  ))
}

/**
 * Graph-level invariants across a whole content tree.
 *
 * Checks, in order:
 *   1. Translated-slug sibling conflicts (`TRANSLATED_SLUG_CONFLICT`, errors only; warns are logged in place)
 *   2. Explicit `id` alignment across locale variants (`CONFLICTING_REFS`)
 *   3. Explicit `id` uniqueness across unrelated content identities (`CONFLICTING_REFS`)
 *   4. Explicit `ref` alignment across locale variants (`CONFLICTING_REFS`)
 *   5. Duplicate canonical id / localized path per locale (`DUPLICATE_CANONICAL_ID` / `DUPLICATE_LOCALIZED_PATH`)
 *   6. Cross-document ref uniqueness (`CONFLICTING_REFS`)
 *   7. Invalid `ref` value shape (`INVALID_REF_VALUE`)
 *   8. Unresolved content-reference links per collection schema (`SCHEMA_VALIDATION_FAILED`; non-strict: warn+pass)
 *
 * Returns `ok(undefined)` when every invariant holds. On the first failing
 * invariant, returns `fail(ContentError)` — graph validation is fail-fast;
 * this mirrors the old throw-on-first behavior while giving callers a typed
 * code to branch on.
 */
export const validateContentGraph = (
  contents: ParsedContent[],
  config: { collections?: Record<string, ContentCollectionConfig>, locales?: string[], translatedSlugs?: boolean, strictTranslatedSlugs?: boolean }
): Result<void, ContentError> => {
  const locales = config.locales || []
  const docs = contents.filter(content => content && content.path)
  const routeEntries = docs.filter(content => !content.partial && !content.navigationFile)
  const markdownEntries = routeEntries.filter(content => content.type === 'markdown')
  const idsByLocale = new Map<string, ParsedContent>()
  const pathsByLocale = new Map<string, ParsedContent>()
  const referenceTargets = buildReferenceTargets(routeEntries, locales)
  const targetCollections = new Map<string, Set<string>>()
  const markdownVariantsByCanonicalKey = new Map<string, ParsedContent[]>()
  const refsByValue = new Map<string, ParsedContent>()

  for (const document of routeEntries) {
    const canonicalId = document.canonicalKey || getCanonicalContentId(document, locales)
    if (!canonicalId || !document.collection) {
      continue
    }
    const collections = targetCollections.get(canonicalId) || new Set<string>()
    collections.add(document.collection)
    targetCollections.set(canonicalId, collections)
  }

  for (const issue of collectTranslatedSlugValidationIssues(markdownEntries, {
    translatedSlugs: config.translatedSlugs,
    locales
  })) {
    if (issue.level === 'warn' && config.strictTranslatedSlugs) {
      return fail(createContentError('TRANSLATED_SLUG_CONFLICT', issue.file, issue.reason, issue.details))
    }

    if (issue.level === 'warn') {
      // Soft issue: surface to the user without aborting the build.
      console.warn(createContentError('INVALID_CONTENT', issue.file, issue.reason, issue.details).message)
      continue
    }

    return fail(createContentError('TRANSLATED_SLUG_CONFLICT', issue.file, issue.reason, issue.details))
  }

  for (const document of markdownEntries) {
    const variantKey = document.canonicalKey || getCanonicalContentId(document, locales)
    const siblings = markdownVariantsByCanonicalKey.get(variantKey) || []
    siblings.push(document)
    markdownVariantsByCanonicalKey.set(variantKey, siblings)
  }

  for (const [variantKey, variants] of markdownVariantsByCanonicalKey.entries()) {
    const explicitRefs = Array.from(new Set(variants
      .map(document => typeof document.ref === 'string' && document.ref.length ? document.ref : undefined)
      .filter((value): value is string => Boolean(value))))

    if (explicitRefs.length > 1) {
      return fail(createContentError(
        'CONFLICTING_REFS',
        variants[0]?.file?.path || variants[0]?.id || variantKey,
        `conflicting refs across locale variants for canonical key "${variantKey}"`,
        explicitRefs.join(', ')
      ))
    }
  }

  for (const document of routeEntries) {
    const canonicalId = document.canonicalKey || getCanonicalContentId(document, locales)
    const localeKey = `${canonicalId}:${document.locale || ''}`
    if (idsByLocale.has(localeKey)) {
      const previous = idsByLocale.get(localeKey)!
      return fail(createContentError(
        'DUPLICATE_CANONICAL_ID',
        document.file?.path || document.id,
        `duplicate canonical id "${canonicalId}" for locale "${document.locale || 'default'}"`,
        `conflicts with ${previous.file?.path || previous.id}`
      ))
    }
    idsByLocale.set(localeKey, document)

    const pathKey = `${document.locale || ''}:${document.path || ''}`
    if (pathsByLocale.has(pathKey)) {
      const previous = pathsByLocale.get(pathKey)!
      return fail(createContentError(
        'DUPLICATE_LOCALIZED_PATH',
        document.file?.path || document.id,
        `duplicate localized path "${document.path}" for locale "${document.locale || 'default'}"`,
        `conflicts with ${previous.file?.path || previous.id}`
      ))
    }
    pathsByLocale.set(pathKey, document)
  }

  for (const document of markdownEntries) {
    if (typeof document.ref !== 'undefined' && (typeof document.ref !== 'string' || !document.ref.length)) {
      return fail(createContentError(
        'INVALID_REF_VALUE',
        document.file?.path || document.id,
        'ref must be a non-empty string'
      ))
    }

    const ref = typeof document.ref === 'string' && document.ref.length ? document.ref : undefined
    if (!ref) {
      continue
    }

    const previous = refsByValue.get(ref)
    if (previous && (previous.canonicalKey || getCanonicalContentId(previous, locales)) !== (document.canonicalKey || getCanonicalContentId(document, locales))) {
      return fail(createContentError(
        'CONFLICTING_REFS',
        document.file?.path || document.id,
        `duplicate ref "${ref}"`,
        `conflicts with ${previous.file?.path || previous.id}`
      ))
    }

    refsByValue.set(ref, document)
  }

  for (const document of docs) {
    if (!document.collection) {
      continue
    }

    const collection = getCollectionConfig(document.collection, config.collections)
    const references = (collection as { references?: Record<string, string[]> } | undefined)?.references
    const schema = collection?.schema
    if (!schema && !references) {
      continue
    }

    const issues: string[] = []
    const resolveReference = (value: string, collection?: string) => {
      const canonicalId = referenceTargets.get(normalizeReferenceValue(value))
      if (!canonicalId) {
        return false
      }
      return collection ? targetCollections.get(canonicalId)?.has(collection) === true : true
    }
    if (schema) {
      collectReferenceIssues(schema, document, resolveReference, issues)
    } else {
      collectDerivedReferenceIssues(references, document as Record<string, unknown>, resolveReference, issues)
    }
    if (!issues.length) {
      continue
    }

    const error = createContentError(
      'SCHEMA_VALIDATION_FAILED',
      document.file?.path || document.id,
      'unresolved content references',
      issues.join('; ')
    )
    if (collection?.strict === false) {
      // Non-strict collection: warn and continue; do not abort graph validation.
      console.warn(error.message)
      continue
    }

    return fail(error)
  }

  return ok(undefined)
}
