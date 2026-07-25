import type { ZodTypeAny } from 'zod'

/**
 * Stable Zod metadata key used to identify authored content references.
 *
 * Reference identity lives in schema metadata, never in `.describe()` text.
 * Prefer `reference()` or `withContentReferenceMetadata()` over writing this
 * key by hand.
 */
export const CONTENT_REFERENCE_METADATA_KEY = 'ginko:contentReference'

export type ContentReferenceMetadata = {
  collection?: string
}

export const withContentReferenceMetadata = <T extends ZodTypeAny>(
  schema: T,
  collection?: string,
): T => schema.meta({
  [CONTENT_REFERENCE_METADATA_KEY]: collection ? { collection } : {},
}) as T

export const getContentReferenceMetadata = (
  schema: unknown,
): ContentReferenceMetadata | null => {
  if (!schema || typeof schema !== 'object' || !('meta' in schema)) return null
  const readMeta = (schema as { meta?: () => Record<string, unknown> | undefined }).meta
  if (typeof readMeta !== 'function') return null
  const value = readMeta.call(schema)?.[CONTENT_REFERENCE_METADATA_KEY]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const collection = (value as Record<string, unknown>).collection
  return typeof collection === 'string' && collection
    ? { collection }
    : {}
}
