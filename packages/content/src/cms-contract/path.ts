/**
 * Pure path helpers re-exported from `ginko-content`'s canonical path engine.
 *
 * The CMS uses these instead of duplicating its own path-generation logic.
 * Per Gate 0 of the refactor: ginko-content owns path semantics; ginko-cms
 * imports them. No more parallel implementations of `generatePath` /
 * `generateCanonicalKey` / `slugifyUrlSegment`.
 *
 * All re-exports MUST be runtime-pure (no Node, no Nuxt, no h3). They are.
 */

export {
  describeId,
  generatePath,
  generateCanonicalKey,
  generateTitle,
  isDraftPath,
  isPartialPath,
  normalizeContentPath,
  normalizeRouteMounts,
  longestMountForPath,
  routeRemainder,
  mountContentPath,
  prefixPathWithLocale,
  stripLocalePrefix,
  refineUrlPart,
  routeToContentPathCandidates,
} from '../core/content/path.js'

export { slugifyUrlSegment } from '../core/content/slug.js'
