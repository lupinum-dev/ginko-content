/**
 * Pure path helpers re-exported from `ginko-content`'s canonical path engine.
 *
 * External CMS integrations use these instead of duplicating path-generation
 * logic. Ginko Content remains the sole owner of public path semantics.
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
  routeRemainder,
  mountContentPath,
  prefixPathWithLocale,
  stripLocalePrefix,
  refineUrlPart,
} from '../core/content/path.js'

export { slugifyUrlSegment } from '../core/content/slug.js'
