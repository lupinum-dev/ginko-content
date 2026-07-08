import type { MissingDocument, ParsedContent } from '../../types/content'

/**
 * True when a loader result is a {@link MissingDocument} sentinel rather than a
 * real parsed document. Keyed on the `missing: true` discriminant that every
 * stub site sets — NOT on `body === null`: a real document may legitimately
 * have a null body (data-style documents from custom transformers, e.g. the
 * transformer example's `.names` files) and must not be treated as missing.
 */
export const isMissingDocument = (
  document: ParsedContent | MissingDocument
): document is MissingDocument => (document as MissingDocument).missing === true

/**
 * Shared type guard narrowing a loader result to a servable
 * {@link ParsedContent}. Replaces the per-call-site `body !== null` checks so
 * every consumer (snapshot writer, content list, single-document lookup) agrees
 * on what counts as a real document.
 */
export const isRealDocument = (
  document: ParsedContent | MissingDocument
): document is ParsedContent => !isMissingDocument(document)
