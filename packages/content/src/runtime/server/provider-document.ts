import type { ContentFileMeta, ParsedContent } from '../../types/content'
import type { ContentPageResult } from '../../types/query'
import { ContentError } from '../../core/errors'
import { collectJsonPurityViolations, formatJsonPurityViolations } from '../../core/json-value'
import { normalizeRouteMounts, type RouteMounts } from '../../features/localization/path'
import { localizePageResult } from '../../features/localization/results'

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
 * Minimal document a third-party provider must emit. Only `collection`,
 * `locale`, `path` and `body` are strictly required — `id`, `canonicalKey` and
 * `type` are derived when omitted, and `file` is optional (absent for providers
 * with no backing file, e.g. CMS-backed documents). Any additional frontmatter
 * fields are passed through untouched.
 */
export interface ProviderDocumentInput extends Record<string, unknown> {
  /** Collection the document belongs to. */
  collection: string
  /** Locale code for this concrete variant. */
  locale: string
  /** Canonical (source-agnostic) route path this variant serves at. */
  path: string
  /** Parsed body payload (`null` for documents with no renderable body). */
  body: ParsedContent['body']
  /** Fully-qualified system id. Derived from `locale` + `path` when omitted. */
  id?: string
  /**
   * Opaque, locale-agnostic identity join key. Derived from `collection` +
   * `path` when omitted. Never parse or render it as a URL.
   */
  canonicalKey?: string
  /** Document kind. Defaults to `'markdown'`. */
  type?: ParsedContent['type']
  /** Optional file provenance. Absent for providers with no backing file. */
  file?: ContentFileMeta
}

/**
 * Options describing the provider's locale/route configuration so core can
 * derive the localized route envelope. For single-locale providers these can be
 * omitted entirely.
 */
export interface ShapeProviderDocumentOptions {
  /** Default locale of the site (defaults to the document's own locale). */
  defaultLocale?: string
  /** All configured locales (defaults to the document's own locale). */
  locales?: string[]
  /** Route mount(s) for the collection, used to project localized paths. */
  route?: string | Record<string, string>
  /** Pre-computed route mounts (takes precedence over `route`). */
  routeMounts?: RouteMounts
}

/**
 * Normalize a provider's raw document into the canonical content envelope,
 * filling in the derivable identity fields (`id`, `canonicalKey`, `type`) while
 * leaving `file` absent unless the provider supplied it.
 */
export const normalizeProviderDocument = (input: ProviderDocumentInput): ParsedContent => {
  const collection = input.collection
  const locale = input.locale
  const path = input.path
  const type = input.type ?? 'markdown'
  const canonicalKey = input.canonicalKey ?? `${collection}:${trimSlashes(path) || 'index'}`
  const extension = input.file?.extension ?? extensionForType(type)
  const id = input.id ?? `content:${locale}:${trimSlashes(path).replace(/\//g, ':') || 'index'}.${extension}`

  const document = {
    ...input,
    id,
    collection,
    locale,
    path,
    canonicalKey,
    type,
    ...(input.file ? { file: input.file } : {}),
    body: input.body
  } as ParsedContent

  // Same canonical JSON-purity gate as the filesystem ingest path (VNEXT
  // §11, §21): a provider document must be JSON-pure before it can reach
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

/**
 * Normalize a provider's raw document and derive the full route envelope
 * (`path`, `variants`, `localePaths`, `resolved`). The result is the canonical
 * `ContentPageResult` route helpers return, so a provider can back its `page`,
 * `routeMeta` and `query` methods from the minimal document set alone.
 */
export const shapeProviderDocument = <T = ParsedContent>(
  input: ProviderDocumentInput,
  options: ShapeProviderDocumentOptions = {}
): ContentPageResult<T> => {
  const document = normalizeProviderDocument(input)
  const defaultLocale = options.defaultLocale ?? input.locale
  const locales = options.locales ?? [input.locale]
  const routeMounts = options.routeMounts
    ?? normalizeRouteMounts(options.route, locales, defaultLocale)

  return localizePageResult(
    document as ParsedContent & Record<string, unknown>,
    input.locale,
    defaultLocale,
    locales,
    routeMounts
  ) as ContentPageResult<T>
}
