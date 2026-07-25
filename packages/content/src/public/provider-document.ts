import type { ContentFileMeta, ParsedContent } from '../types/content'
import { ContentError } from '../core/errors'
import { collectJsonPurityViolations, formatJsonPurityViolations } from '../core/json-value'
import { normalizeSiteRelativeContentPath } from '../core/content/path'
import { isMarkdownRoot } from '../core/markdown/tree'

/**
 * The single normalization seam for provider-authored documents.
 *
 * Third-party providers should emit only the required identity fields (plus any
 * frontmatter data they wish to expose). Core derives the public `route` and
 * `resolution` envelopes from these fields, so providers never hand-build
 * route shaping metadata themselves.
 */

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '')
const providerDocumentTypes = new Set<NonNullable<ParsedContent['type']>>(['markdown', 'yaml', 'json', 'csv'])
const providerDerivedKeys = ['path', 'resolved', 'variants', 'localePaths', 'unprefixedPath', 'dir', 'route', 'resolution'] as const

export interface ContentProviderVariantFact {
  locale: string
  contentPath: string
}

const extensionForType = (type: ParsedContent['type']): ContentFileMeta['extension'] => {
  switch (type) {
    case 'yaml':
      return 'yml'
    case 'json':
      return 'json'
    case 'csv':
      return 'csv'
    default:
      return 'md'
  }
}

/**
 * Raw provider document. Route facts are validated here and consumed by core
 * before the public route/resolution envelope is created.
 */
export interface ProviderDocumentInput extends Record<string, unknown> {
  /** Collection the document belongs to. */
  collection: string
  /** Locale code for this concrete variant. */
  locale: string
  /** Locale-specific content route before Nuxt locale-prefix strategy. */
  contentPath: string
  /** Concrete variants visible for this request; never include drafts hidden by provider policy or synthesized fallbacks. */
  routeVariants?: readonly ContentProviderVariantFact[]
  /** Parsed Markdown AST or structured JSON payload (`null` when absent). */
  body: ParsedContent['body']
  /** Fully-qualified system id. Derived from `locale` + `contentPath` when omitted. */
  id?: string
  /** Opaque, locale-agnostic identity join key. */
  canonicalKey: string
  /** Document kind. Defaults to `'markdown'`. */
  type?: ParsedContent['type']
  /** Optional file provenance. Absent for providers with no backing file. */
  file?: ContentFileMeta
}

export interface ValidatedProviderDocument extends Record<string, unknown> {
  readonly id: string
  readonly collection: string
  readonly locale: string
  readonly contentPath: string
  readonly canonicalKey: string
  readonly type: NonNullable<ParsedContent['type']>
  readonly body: ParsedContent['body']
  readonly file?: ContentFileMeta
  readonly routeVariants: readonly ContentProviderVariantFact[]
}

/**
 * Validate a provider's raw document and fill derivable provider fields
 * (`id`, `type`, `routeVariants`). Canonical and public paths are created only
 * after this boundary.
 */
export const normalizeProviderDocument = (input: ProviderDocumentInput): ValidatedProviderDocument => {
  const collection = input.collection
  const locale = input.locale
  if (typeof collection !== 'string' || !collection || typeof locale !== 'string' || !locale) {
    throw new ContentError('INVALID_CONTENT', 'Invalid provider document: collection and locale must be non-empty strings.')
  }
  if (typeof input.canonicalKey !== 'string' || !input.canonicalKey) {
    throw new ContentError('INVALID_CONTENT', 'Invalid provider document: canonicalKey must be a non-empty string.')
  }
  if (input.id !== undefined && (typeof input.id !== 'string' || !input.id)) {
    throw new ContentError('INVALID_CONTENT', 'Invalid provider document: id must be a non-empty string when provided.')
  }
  if (input.type !== undefined && !providerDocumentTypes.has(input.type)) {
    throw new ContentError('INVALID_CONTENT', 'Invalid provider document: type must be markdown, yaml, json, or csv.')
  }
  const type = input.type ?? 'markdown'
  if (type === 'markdown' && input.body !== null && !isMarkdownRoot(input.body)) {
    throw new ContentError('INVALID_CONTENT', 'Invalid provider document: body must be null or a root Markdown AST.')
  }
  const derivedKey = providerDerivedKeys.find(key => Object.prototype.hasOwnProperty.call(input, key))
  if (derivedKey) {
    throw new ContentError('INVALID_CONTENT', `Invalid provider document: "${derivedKey}" is derived by core and must not be returned by a provider.`)
  }
  if (input.file !== undefined) {
    if (!input.file || typeof input.file !== 'object' || Array.isArray(input.file)) {
      throw new ContentError('INVALID_CONTENT', 'Invalid provider document: file must be an object when provided.')
    }
    for (const key of ['source', 'path', 'stem', 'dir', 'basename', 'extension'] as const) {
      if (input.file[key] !== undefined && typeof input.file[key] !== 'string') {
        throw new ContentError('INVALID_CONTENT', `Invalid provider document: file.${key} must be a string when provided.`)
      }
    }
  }
  let contentPath: string
  try {
    contentPath = normalizeSiteRelativeContentPath(input.contentPath)
  } catch {
    throw new ContentError('INVALID_CONTENT', 'Invalid provider document: contentPath must be a leading-slash, site-relative content route.')
  }
  const extension = input.file?.extension ?? extensionForType(type)
  const id = input.id ?? `content:${locale}:${trimSlashes(contentPath).replace(/\//g, ':') || 'index'}.${extension}`

  const variants = input.routeVariants ?? [{ locale, contentPath }]
  if (!Array.isArray(variants)) {
    throw new ContentError('INVALID_CONTENT', 'Invalid provider document: routeVariants must be an array when provided.')
  }
  const seenLocales = new Set<string>()
  const routeVariants = variants.map((variant, index) => {
    if (!variant || typeof variant.locale !== 'string' || !variant.locale) {
      throw new ContentError('INVALID_CONTENT', `Invalid provider route variant at index ${index}: locale must be a non-empty string.`)
    }
    if (seenLocales.has(variant.locale)) {
      throw new ContentError('INVALID_CONTENT', `Invalid provider route variants: locale "${variant.locale}" appears more than once.`)
    }
    seenLocales.add(variant.locale)
    try {
      return { locale: variant.locale, contentPath: normalizeSiteRelativeContentPath(variant.contentPath) }
    } catch {
      throw new ContentError('INVALID_CONTENT', `Invalid provider route variant at index ${index}: contentPath must be a leading-slash, site-relative content route.`)
    }
  })
  if (!seenLocales.has(locale)) {
    throw new ContentError('INVALID_CONTENT', `Invalid provider document "${id}": routeVariants must include the resolved locale "${locale}".`)
  }
  const resolvedVariant = routeVariants.find(variant => variant.locale === locale)!
  if (resolvedVariant.contentPath !== contentPath) {
    throw new ContentError('INVALID_CONTENT', `Invalid provider document "${id}": contentPath must match the routeVariants entry for resolved locale "${locale}".`)
  }
  const document: ValidatedProviderDocument = {
    ...input,
    id,
    collection,
    locale,
    contentPath,
    routeVariants,
    canonicalKey: input.canonicalKey,
    type,
    ...(input.file ? { file: input.file } : {}),
    body: input.body
  }

  // Same canonical JSON-purity gate as the filesystem ingest path: a provider document must be JSON-pure before it can reach
  // graph insertion, in dev and in build alike.
  const violations = collectJsonPurityViolations(document)
  if (violations.length) {
    const file = document.file?.path || document.id
    throw new ContentError(
      'NON_JSON_VALUE',
      `Invalid content in ${file} (collection "${collection}"): document contains non-JSON value(s) — ${formatJsonPurityViolations(violations)}`,
      { file, collection, violations }
    )
  }

  return document
}
