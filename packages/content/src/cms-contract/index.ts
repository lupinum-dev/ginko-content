/**
 * @lupinum/ginko-content/cms-contract
 *
 * Pure, runtime-safe surface that ginko-cms consumes. This subpath contains
 * NO Node, Nuxt, h3, nitropack, filesystem, or @nuxt/kit dependencies. Every
 * module re-exported from here MUST be importable from a V8 isolate (Convex
 * component, Cloudflare Workers, browser).
 *
 * The CMS uses this surface to:
 *  - normalize a host's `content.config.ts` into a `CmsContract` artifact
 *    (`buildCmsContract`),
 *  - introspect Zod schemas without re-implementing the walker
 *    (`unwrapSchema`, `getObjectShape`, `getReferenceDescriptor`, ...),
 *  - generate paths consistently with how the filesystem provider does
 *    (`generatePath`, `generateCanonicalKey`, `slugifyUrlSegment`),
 *  - parse MDC into the same AST the filesystem provider uses (`parseMdcBody`).
 *
 * If a future change introduces a Node/Nuxt dependency anywhere in this
 * tree, the CMS Convex build will break loudly. That's intentional.
 */

export {
  CMS_CONTRACT_VERSION,
  CmsContractSchemaUnsupportedError,
  buildCmsContract,
  type BuildCmsContractInput,
  type BuildCmsContractOptions,
} from './build.js'

export type {
  CmsCollectionContract,
  CmsCollectionRouting,
  CmsContract,
  CmsFieldContract,
  CmsSchemaArtifactRef,
  CmsSchemaCapabilities,
  ContentCmsCollectionConfig,
  ContentCmsFieldConfig,
  ContentCmsFieldType,
  ContentCmsRelationConfig,
  ContentCollectionConfig,
  ContentCollectionI18nConfig,
} from './types.js'

export {
  describeId,
  generatePath,
  generateCanonicalKey,
  generateTitle,
  isDraftPath,
  isPartialPath,
  longestMountForPath,
  mountContentPath,
  normalizeContentPath,
  normalizeRouteMounts,
  prefixPathWithLocale,
  refineUrlPart,
  routeRemainder,
  routeToContentPathCandidates,
  slugifyUrlSegment,
  stripLocalePrefix,
} from './path.js'

export {
  CONTENT_FIELD_METADATA_KEY,
  CONTENT_REFERENCE_PREFIX,
  collectTopLevelReferenceFields,
  getContentFieldMetadata,
  getObjectShape,
  getReferenceDescriptor,
  getSchemaDef,
  getSchemaTypeName,
  unwrapSchema,
  type ContentFieldMetadata,
  type ContentFieldSchema,
} from './schema.js'

export {
  parseMdcBody,
  type ParseMdcBodyOptions,
  type ParseMdcBodyResult,
} from './mdc.js'
