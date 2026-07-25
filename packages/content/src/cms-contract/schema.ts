/**
 * Pure Zod-schema introspection helpers, re-exported for CMS use.
 *
 * These are how the CMS understands what a collection's `schema` field means:
 * walks down through Optional / Nullable / Default / Effects wrappers,
 * extracts object shapes, recognizes content-reference fields.
 *
 * Pure functions over Zod's internal `_def` shape. No runtime deps beyond
 * the symbols Zod itself exposes.
 */

export {
  getSchemaDef,
  getSchemaTypeName,
  unwrapSchema,
  getObjectShape,
  getReferenceDescriptor,
  collectTopLevelReferenceFields,
} from '../core/references/schema.js'

/**
 * Symbol Zod schemas may carry to expose ginko-content's UI metadata
 * (label, description, options, slug source, image/asset constraints, etc.).
 */
export {
  CONTENT_FIELD_METADATA_KEY,
  type ContentFieldMetadata,
  type ContentFieldSchema,
} from '../types/fields.js'

export { getContentFieldMetadata } from '../types/fields.js'

export {
  CONTENT_REFERENCE_METADATA_KEY,
} from '../types/reference.js'
