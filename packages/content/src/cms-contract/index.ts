/**
 * @lupinum/ginko-content/cms-contract
 *
 * Pure, runtime-safe surface that ginko-cms consumes. This subpath contains
 * NO Node, Nuxt, h3, nitropack, filesystem, or @nuxt/kit dependencies. Every
 * module re-exported from here MUST be importable from a V8 isolate (Convex
 * component, Cloudflare Workers, browser).
 *
 * The CMS uses this surface to:
 *  - normalize a host's `content.config.ts` into the one portable
 *    `ResolvedContentContractV1` artifact (`buildResolvedContentContract`),
 *  - produce RFC 8785 canonical JSON and incremental SHA-256 hashes without
 *    relying on Node or Web Crypto,
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
  RESOLVED_CONTENT_CONTRACT_VERSION,
  buildResolvedContentContract,
  type BuildResolvedContentContractInput,
  type BuildResolvedContentContractOptions,
} from './build.js'

export type {
  PortableComponentPolicyV1,
  PortableMediaType,
  ResolvedContentCollectionV1,
  ResolvedContentContractV1,
  ResolvedContentFieldTypeV1,
  ResolvedContentFieldV1,
  ResolvedContentValidationV1,
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

export {
  canonicalJsonBytes,
  hashCanonicalJson,
  sha256Hex,
  type JsonPrimitive,
  type JsonValue,
} from './hash.js'

export { assertResolvedContentContract } from './validate.js'

export {
  assertCmsRequestedFacts,
  cmsPublicEntryWireSchema,
  parseCmsListWireResult,
  parseCmsNavWireResult,
  parseCmsPageWireResult,
  parseCmsRoutesWireResult,
  parseCmsSearchWireResult,
  parseCmsSiteDataWireResult,
  parseCmsSurroundWireResult,
  type CmsPublicEntryWire,
} from './provider-wire.js'
