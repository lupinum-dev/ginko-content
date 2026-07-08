import type { MissingDocument, ParsedContent } from '../../types/content'

/**
 * True when a loader result is a {@link MissingDocument} sentinel rather than a
 * real parsed document. Keyed on `body === null`, which every missing stub
 * carries (ignored file, absent source body, or unsupported extension); a real
 * document always has a non-null body.
 */
export const isMissingDocument = (
  document: ParsedContent | MissingDocument
): document is MissingDocument => document.body === null

/**
 * Shared type guard narrowing a loader result to a servable
 * {@link ParsedContent}. Replaces the per-call-site `body !== null` checks so
 * every consumer (snapshot writer, content list, single-document lookup) agrees
 * on what counts as a real document.
 */
export const isRealDocument = (
  document: ParsedContent | MissingDocument
): document is ParsedContent => !isMissingDocument(document)
