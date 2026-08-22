/**
 * @lupinum/ginko-content/cms-contract
 *
 * Pure, runtime-safe surface for CMS/provider consumers. This subpath contains
 * NO Node, Nuxt, h3, nitropack, filesystem, or @nuxt/kit dependencies. Every
 * module re-exported from here MUST be importable from a V8 isolate, worker,
 * or browser.
 *
 * Consumers use this surface to:
 *  - normalize a host's `content.config.ts` into the one portable
 *    `ResolvedContentContractV1` artifact (`buildResolvedContentContract`),
 *  - produce RFC 8785 canonical JSON and incremental SHA-256 hashes without
 *    relying on Node or Web Crypto,
 *  - introspect Zod schemas without re-implementing the walker
 *    (`unwrapSchema`, `getObjectShape`, `getReferenceDescriptor`, ...),
 *  - generate paths consistently with how the filesystem provider does
 *    (`generatePath`, `generateCanonicalKey`, `slugifyUrlSegment`),
 *  - parse MDC with the fixed portable-baseline profile (`parseMdcBody`); site
 *    filesystem plugins may intentionally produce an enriched AST.
 *
 * If a future change introduces a Node/Nuxt dependency anywhere in this
 * tree, isolate builds will break loudly. That's intentional.
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
  mountContentPath,
  normalizeContentPath,
  normalizeRouteMounts,
  prefixPathWithLocale,
  refineUrlPart,
  routeRemainder,
  slugifyUrlSegment,
  stripLocalePrefix,
} from './path.js'

export {
  CONTENT_FIELD_METADATA_KEY,
  CONTENT_REFERENCE_METADATA_KEY,
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
  assertPublicMarkdownAst,
  isSafePublicMarkdownUrl,
  PublicMarkdownValidationError,
  validatePublicMarkdownAst,
  type PublicMarkdownIssue,
  type PublicMarkdownIssueCode,
  type PublicMarkdownValidationResult,
} from './render-policy.js'

export {
  verifyPublicImageBytes,
  type VerifiedPublicImage,
} from './asset-bytes.js'

export {
  canonicalJsonBytes,
  hashCanonicalJson,
  sha256Hex,
  IncrementalSha256,
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
