import type { ContentFileMeta, ParsedContent } from '../../types/content'
import { ContentError } from '../../core/errors'
import { collectJsonPurityViolations, formatJsonPurityViolations } from '../../core/json-value'
import { normalizeContentPath } from '../../core/content/path'

/**
 * The single normalization seam for provider-authored documents.
 *
 * Third-party providers should emit only the required identity fields (plus any
 * frontmatter data they wish to expose). Everything a route consumer needs —
 * the localized route `path`, `variants`, `localePaths`, and the `resolved`
 * envelope — is *derived* by core from these fields, so providers never hand-
 * build that shaping metadata themselves.
 */

const trimSlashes = (value: string) => value.replace(/^\/+|\/+$/g, '')

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
  /** Concrete variants only; never include synthesized fallback entries. */
  routeVariants?: readonly ContentProviderVariantFact[]
  /** Parsed body payload (`null` for documents with no renderable body). */
  body: ParsedContent['body']
  /** Fully-qualified system id. Derived from `locale` + `path` when omitted. */
  id?: string
  /**
   * Opaque, locale-agnostic identity join key. Required for localized
   * providers; single-locale providers may use the stable path derivation.
   */
  canonicalKey?: string
  /** Document kind. Defaults to `'markdown'`. */
  type?: ParsedContent['type']
  /** Optional file provenance. Absent for providers with no backing file. */
  file?: ContentFileMeta
}

export type NormalizedProviderDocument = ParsedContent & {
  collection: string
  locale: string
  path: string
  canonicalKey: string
}

/**
 * Normalize a provider's raw document into the canonical content envelope,
 * filling in the derivable identity fields (`id`, `canonicalKey`, `type`) while
 * leaving `file` absent unless the provider supplied it.
 */
export const normalizeProviderDocument = (input: ProviderDocumentInput): NormalizedProviderDocument => {
  const collection = input.collection
  const locale = input.locale
  const contentPath = normalizeContentPath(input.contentPath)
  const type = input.type ?? 'markdown'
  const canonicalKey = input.canonicalKey ?? `${collection}:${trimSlashes(contentPath) || 'index'}`
  const extension = input.file?.extension ?? extensionForType(type)
  const id = input.id ?? `content:${locale}:${trimSlashes(contentPath).replace(/\//g, ':') || 'index'}.${extension}`

  const variants = input.routeVariants ?? [{ locale, contentPath }]
  const seenLocales = new Set<string>()
  const routeVariants = variants.map((variant, index) => {
    if (!variant || typeof variant.locale !== 'string' || !variant.locale) {
      throw new ContentError('INVALID_CONTENT', `Invalid provider route variant at index ${index}: locale must be a non-empty string.`)
    }
    if (seenLocales.has(variant.locale)) {
      throw new ContentError('INVALID_CONTENT', `Invalid provider route variants: locale "${variant.locale}" appears more than once.`)
    }
    seenLocales.add(variant.locale)
    return { locale: variant.locale, contentPath: normalizeContentPath(variant.contentPath) }
  })
  if (!seenLocales.has(locale)) {
    throw new ContentError('INVALID_CONTENT', `Invalid provider document "${id}": routeVariants must include the resolved locale "${locale}".`)
  }

  const document = {
    ...input,
    id,
    collection,
    locale,
    path: contentPath,
    contentPath,
    routeVariants,
    canonicalKey,
    type,
    ...(input.file ? { file: input.file } : {}),
    body: input.body
  } as NormalizedProviderDocument

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
