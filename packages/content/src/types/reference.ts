import type { ZodTypeAny } from 'zod'

/**
 * Stable Zod metadata key used to identify authored content references.
 *
 * The value intentionally retains the original exported string so existing
 * consumers importing `CONTENT_REFERENCE_PREFIX` do not break.
 */
export const CONTENT_REFERENCE_METADATA_KEY = '__nuxt_content_ref__:'

/** @deprecated Use `CONTENT_REFERENCE_METADATA_KEY`. */
export const CONTENT_REFERENCE_PREFIX = CONTENT_REFERENCE_METADATA_KEY

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
