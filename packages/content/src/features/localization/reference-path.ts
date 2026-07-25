import type { ParsedContent } from '../../types/content'
import type { ResolvedCollectionLocalePolicy } from './locale-policy'
import { mountProviderContentPath } from './route-projector'

/**
 * Preserve the released provider-mounted path vocabulary as a reference
 * alias while the graph stores only canonical mount-agnostic paths.
 */
export const providerReferencePathAliases = (
  document: ParsedContent,
  policies: Readonly<Record<string, ResolvedCollectionLocalePolicy>>
): readonly string[] => {
  if (!document.collection) return []
  const policy = policies[document.collection]
  if (!policy) return []
  return [mountProviderContentPath({
    contentPath: document.path || '/',
    locale: document.locale || policy.defaultLocale
  }, policy)]
}
