/**
 * The one core publication-visibility decision.
 *
 * Providers return content plus facts (a `draft` flag, publication state).
 * This module owns the single app-facing decision of whether draft content
 * is visible, given explicit environment/preview inputs. It does not read
 * `import.meta.dev`/`NODE_ENV` scattered across consumer code, does not call
 * Nuxt composables, and does not read request cookies directly — callers
 * (server transport, module build hooks) resolve those facts and pass them
 * in, which keeps this module testable without H3.
 *
 * Structural route eligibility (data collections, partials, navigation
 * control files are not routable documents) is a *different* question from
 * publication visibility and is intentionally NOT decided here — each
 * consumer keeps that check next to its own structural logic.
 *
 * Per-surface consumer filters (`navigation: false`, `sitemap: false`,
 * search opt-outs) are also intentionally NOT decided here: those affect
 * exactly one consumer each and stay owned by that consumer.
 */
import { createContentProviderError } from './provider-errors'

/** The two build/runtime environments the visibility decision distinguishes. */
export type ContentVisibilityEnvironment = 'development' | 'production'

/**
 * Explicit inputs to the publication-visibility decision. Every field is a
 * plain fact resolved by the caller — no global/ambient state is read here.
 */
export interface ContentVisibilityContext {
  /** The resolved build/runtime environment for this request or build. */
  environment: ContentVisibilityEnvironment
  /**
   * Whether this request/build presents valid, provider-supported preview
   * authorization (e.g. a matching preview token). Absent/false means no
   * preview authorization was presented or the transport doesn't support one.
   */
  previewAuthorized?: boolean
  /**
   * An explicit caller override (e.g. a module `sitemap.includeDrafts`
   * setting, or an HTTP `includeDrafts` query param already gated behind
   * `previewAuthorized`). When set, it takes precedence over the
   * environment/preview default.
   */
  includeDrafts?: boolean
}

/** The publication facts a provider document/route-record carries. */
export interface ContentPublicationFacts {
  draft?: boolean
}

/**
 * Resolve the runtime/build environment from the one canonical signal
 * (`import.meta.dev`). This is the single sanctioned read of that global —
 * consumer code should call this function (or receive its result) instead of
 * inlining its own `import.meta.dev`/`NODE_ENV` check.
 */
export const resolveRuntimeEnvironment = (): ContentVisibilityEnvironment =>
  import.meta.dev ? 'development' : 'production'

/**
 * Decide whether draft-flagged content should be included, given explicit
 * environment/preview/override inputs:
 *
 *  - an explicit `includeDrafts` override always wins;
 *  - otherwise, development is permissive (drafts visible);
 *  - otherwise, production is permissive only when preview is authorized;
 *  - otherwise (production, no preview), drafts are hidden.
 */
export const resolveIncludeDrafts = (context: ContentVisibilityContext): boolean => {
  if (typeof context.includeDrafts === 'boolean') {
    return context.includeDrafts
  }

  return context.environment === 'development' || Boolean(context.previewAuthorized)
}

/**
 * The one core publication-visibility predicate: is this document's
 * publication state visible under the given context? Structural eligibility
 * (partial/navigationFile/data-collection) is a separate question the caller
 * must apply on its own.
 */
export const isPublicationVisible = (
  facts: ContentPublicationFacts,
  context: ContentVisibilityContext
): boolean => !facts.draft || resolveIncludeDrafts(context)

/**
 * The filesystem provider serves an immutable, sealed snapshot in
 * production: it cannot overlay draft/preview content
 * without rebuilding, so an authenticated preview request against it in
 * production is not a smaller/degraded feature — it is unsupported and must
 * fail before any query dispatch touches the sealed graph, rather than
 * silently exposing (or silently hiding) the drafts that happen to be baked
 * into that snapshot.
 *
 * Production preview against a real content provider is provider-owned and
 * unaffected by this guard.
 */
export const assertFilesystemPreviewSupported = (
  context: Pick<ContentVisibilityContext, 'environment' | 'previewAuthorized'>
): void => {
  if (context.environment === 'production' && context.previewAuthorized) {
    throw createContentProviderError(
      'unsupported_filesystem_preview',
      'Production preview requires a content provider. The filesystem provider serves an immutable sealed snapshot in production and cannot overlay draft/preview content — configure a provider-owned preview workflow, or disable preview for filesystem production deployments.',
      { provider: 'filesystem' }
    )
  }
}
