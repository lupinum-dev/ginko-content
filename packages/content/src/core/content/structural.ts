/**
 * Module-private source classification. `navigationFile` intentionally does
 * not belong to the public `ParsedContent` contract: it only exists between
 * parsing and structural graph/navigation processing.
 */
export const isNavigationFile = (document: unknown): boolean =>
  Boolean(document)
  && typeof document === 'object'
  && (document as { navigationFile?: boolean }).navigationFile === true
