import { normalizeContentPath } from '../../core/content/path'
import type { RuntimeDiagnostic } from '../../core/runtime-diagnostics'
import type { ContentProviderQueryInput } from '../../types/query'
import type { ResolvedCollectionLocalePolicy } from '../localization/locale-policy'
import { unmountProviderContentPath } from '../localization/route-projector'

export const collectMountedPathSelectorMissDiagnostic = (
  params: ContentProviderQueryInput,
  policy: ResolvedCollectionLocalePolicy
): RuntimeDiagnostic | undefined => {
  const selector = params.resolveVariant
  const requested = selector?.path
  if (!requested || !params.collection) return

  const locale = selector.locale || params.resolveLocale?.locale || policy.defaultLocale
  const mount = policy.localized ? policy.routeMounts[locale] : policy.routeMounts.default
  if (!mount) return

  let canonical: string
  try {
    canonical = unmountProviderContentPath(requested, locale, policy)
  }
  catch {
    return
  }

  const normalizedRequest = normalizeContentPath(requested)
  if (canonical === normalizedRequest) return

  return {
    key: `path-selector-miss:${params.collection}:${locale}:${normalizedRequest}`,
    message: `No document matched by: { path: "${normalizedRequest}" } `
      + `in collection "${params.collection}" (locale "${locale}"). `
      + `Path selectors are canonical and exclude the collection route mount "${normalizeContentPath(mount)}". `
      + `If that value was the mounted path, its canonical form is "${canonical}". `
      + `If "${normalizedRequest}" is genuinely canonical, no such document exists.`
  }
}
