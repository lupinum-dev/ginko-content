import type { ParsedContent } from '../../types/content'

/**
 * Module-private source classification. `navigationFile` intentionally does
 * not belong to the public `ParsedContent` contract: it only exists between
 * parsing and structural graph/navigation processing.
 */
export const isNavigationFile = (document: ParsedContent): boolean =>
  (document as ParsedContent & { navigationFile?: boolean }).navigationFile === true
