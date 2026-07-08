/**
 * @lupinum/ginko-content/cms-contract — pure subpath
 *
 * This module contains the runtime-safe contract types and helpers that
 * `@lupinum/ginko-cms` consumes from inside its Convex component. Everything
 * exported from this subpath MUST be importable from a V8 isolate (Convex,
 * Edge runtime, browser) without pulling Node, Nuxt, h3, nitropack, or
 * filesystem APIs along.
 *
 * Per the ginko-cms refactor plan ("Gate 0 — Lock the boundary"):
 *  - `ginko-content` owns content semantics (schema, paths, i18n, MDC parsing).
 *  - `ginko-cms` owns editorial workflow (drafts, revisions, publish, assets).
 *
 * The CMS imports from this subpath (NOT from the full Nuxt module) so the two
 * packages share one source of truth for what content means.
 */

import type {
  ContentCmsCollectionConfig,
  ContentCmsFieldConfig,
  ContentCmsFieldType,
  ContentCmsRelationConfig,
  ContentCollectionConfig,
  ContentCollectionI18nConfig,
} from '../types/config.js'

export type {
  ContentCmsCollectionConfig,
  ContentCmsFieldConfig,
  ContentCmsFieldType,
  ContentCmsRelationConfig,
  ContentCollectionConfig,
  ContentCollectionI18nConfig,
}

/**
 * The normalized contract a CMS consumes for one collection. This is the
 * deterministic output of `buildCmsContract`: every decision the CMS used to
 * infer (label, type, locales, routing, fields) is materialized here so the
 * CMS never has to re-derive content semantics.
 */
export interface CmsCollectionContract {
  /** Collection identifier (`blog`, `docs`, ...). */
  slug: string
  /** Display label, single-string for monolingual sites or per-locale map. */
  label: string | Record<string, string>
  /** `flat` (e.g. blog posts) or `tree` (e.g. nested docs). */
  type: 'flat' | 'tree'
  /** Optional icon hint for editor surfaces. */
  icon?: string | null
  /** Locales this collection supplies. Always non-empty; defaults to site default. */
  locales: string[]
  /** Default locale for this collection. */
  defaultLocale: string
  /** Routing config the public provider will honor. */
  routing: CmsCollectionRouting
  /** Normalized field set, in stable order. */
  fields: CmsFieldContract[]
  /** Schema artifact reference, if Zod schema was supplied. Validates publish. */
  schema?: CmsSchemaArtifactRef
  /** Free-form per-collection settings (sitemap, search, etc.). */
  settings?: Record<string, unknown>
}

export interface CmsCollectionRouting {
  /** `route` exposes the collection at a public URL; `none` keeps it data-only. */
  mode: 'route' | 'none'
  /** Public URL prefix when `mode === 'route'`. Empty for `mode === 'none'`. */
  pathPrefix: string
  /** Per-locale public URL prefixes for localized route-backed collections. */
  localizedPathPrefixes?: Record<string, string> | null
  /** Per-locale public paths for localized singleton collections. */
  localizedSingletonPaths?: Record<string, string> | null
  /** How slugs combine across locales. */
  slugMode: 'shared' | 'localized' | 'stable' | 'localizedStable'
  /** Optional root entry slug (e.g. an "intro" page that owns the prefix root). */
  rootSlug?: string | null
  /** True when the collection holds exactly one entry. */
  singleton: boolean
}

export interface CmsFieldContract {
  key: string
  type: ContentCmsFieldType
  role?: 'title' | 'description' | 'body' | null
  label?: string | Record<string, string> | null
  description?: string | null
  required: boolean
  localized: boolean
  searchable: boolean
  sortable: boolean
  defaultValue?: unknown
  options?: string[] | null
  relation?: ContentCmsRelationConfig | null
  media?: { accept?: string[]; aspectRatio?: string | null } | null
  fields?: CmsFieldContract[] | null
  validation?: Record<string, unknown> | null
  min?: number | null
  max?: number | null
  step?: number | null
  slugFrom?: string | null
  language?: string | null
  /**
   * Opaque editor-layout passthrough forwarded byte-for-byte from
   * `ContentCmsFieldConfig.editor`. ginko-content neither types nor interprets
   * its contents — pure layout policy (width, display order, hidden state,
   * conditional visibility, ...) lives here and its schema is owned by the
   * consuming CMS. Absent when the collection config supplied no `editor`.
   */
  editor?: Record<string, unknown>
}

/**
 * Reference to a schema validation artifact. The actual artifact (a serialized,
 * checksum-verified validator) is generated at build time by ginko-content and
 * shipped alongside the contract. The CMS reads the checksum to verify the
 * artifact it holds matches the contract it imported.
 *
 * The artifact bytes are embedded so a contract consumer can validate content
 * without fetching a second artifact, while `artifactId` and `checksum` keep the
 * embedded payload identifiable and verifiable.
 */
export interface CmsSchemaArtifactRef {
  /** Stable id used to look up the artifact in the artifact registry. */
  artifactId: string
  /** Stable checksum of the serialized artifact bytes. */
  checksum: string
  /** Schema features the artifact actually supports. */
  capabilities: CmsSchemaCapabilities
  /** Deterministic serialized validation artifact bytes. */
  artifact: string
}

export type CmsSchemaValidationNode =
  | { kind: 'object'; required: string[]; shape: Record<string, CmsSchemaValidationNode> }
  | { kind: 'array'; element: CmsSchemaValidationNode }
  | {
      kind: 'string'
      checks?: Array<
        | { kind: 'min'; value: number }
        | { kind: 'max'; value: number }
        | { kind: 'email' }
        | { kind: 'url' }
      >
    }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'date' }
  | { kind: 'enum'; values: string[] }
  | { kind: 'optional'; inner: CmsSchemaValidationNode }
  | { kind: 'nullable'; inner: CmsSchemaValidationNode }
  | { kind: 'default'; inner: CmsSchemaValidationNode; value: unknown }

export interface CmsSchemaValidationArtifact {
  version: 'v1'
  root: CmsSchemaValidationNode
}

export interface CmsSchemaCapabilities {
  /** Top-level Zod constructs the artifact understands. */
  supports: Array<
    | 'object'
    | 'array'
    | 'string'
    | 'number'
    | 'boolean'
    | 'date'
    | 'enum'
    | 'optional'
    | 'nullable'
    | 'default'
    | 'reference'
  >
  /** Constructs the source schema used that the artifact does NOT support. */
  unsupported: Array<{ feature: string; path: string; reason: string }>
}

/**
 * Top-level CMS contract: one entry per collection plus site-wide settings.
 */
export interface CmsContract {
  /** Schema-version identifier so the CMS can detect a contract upgrade. */
  contractVersion: string
  /** Site default locale. */
  defaultLocale: string
  /** Site-wide locale list (superset of any per-collection locale subset). */
  locales: string[]
  /** Collections keyed by slug. */
  collections: Record<string, CmsCollectionContract>
}
