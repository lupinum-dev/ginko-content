import type {
  ContentCmsCollectionConfig,
  ContentCmsFieldConfig,
  ContentCmsFieldType,
  ContentCmsRelationConfig,
  ContentCollectionConfig,
  ContentCollectionI18nConfig,
} from '../types/config.js'
import type { PortableComponentPolicyV1 } from '../types/component-policy.js'
import type { JsonValue } from './hash.js'

export type {
  ContentCmsCollectionConfig,
  ContentCmsFieldConfig,
  ContentCmsFieldType,
  ContentCmsRelationConfig,
  ContentCollectionConfig,
  ContentCollectionI18nConfig,
  PortableComponentPolicyV1,
}

export type PortableMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export type ResolvedContentFieldTypeV1 =
  | 'text'
  | 'textarea'
  | 'richtext'
  | 'slug'
  | 'email'
  | 'url'
  | 'number'
  | 'range'
  | 'select'
  | 'multiselect'
  | 'radio'
  | 'checkbox'
  | 'toggle'
  | 'date'
  | 'datetime'
  | 'time'
  | 'json'
  | 'object'
  | 'array'
  | 'blocks'
  | 'relation'
  | 'relations'
  | 'image'
  | 'images'
  | 'file'
  | 'icon'
  | 'code'
  | 'color'

export type ResolvedContentValidationV1 =
  | { kind: 'string'; minLength: number | null; maxLength: number | null; format: 'email' | 'url' | 'date' | 'datetime' | 'time' | null }
  | { kind: 'number'; min: number | null; max: number | null; integer: boolean }
  | { kind: 'boolean' }
  | { kind: 'enum'; values: string[] }
  | { kind: 'array'; minItems: number | null; maxItems: number | null; element: ResolvedContentValidationV1 }
  | { kind: 'object'; fields: Record<string, ResolvedContentValidationV1> }
  | { kind: 'nullable'; inner: ResolvedContentValidationV1 }

export interface ResolvedContentFieldV1 {
  key: string
  type: ResolvedContentFieldTypeV1
  role: 'title' | 'description' | 'body' | null
  required: boolean
  localized: boolean
  searchable: boolean
  sortable: boolean
  default: { present: false } | { present: true; value: JsonValue }
  options: string[] | null
  relation: { collection: string; multiple: boolean } | null
  media: { mediaTypes: PortableMediaType[]; aspectRatio: string | null } | null
  fields: ResolvedContentFieldV1[] | null
  validation: ResolvedContentValidationV1 | null
  min: number | null
  max: number | null
  step: number | null
  slugFrom: string | null
  language: string | null
}

export interface ResolvedContentCollectionV1 {
  id: string
  kind: 'page' | 'data'
  structure: 'flat' | 'tree'
  defaultLocale: string
  locales: string[]
  routing: {
    mode: 'route' | 'none'
    pathPrefix: string
    localizedPathPrefixes: Record<string, string> | null
    localizedSingletonPaths: Record<string, string> | null
    slugMode: 'shared' | 'localized' | 'stable' | 'localizedStable'
    rootSlug: string | null
    singleton: boolean
    allowMultipleRoots: boolean
  }
  fields: ResolvedContentFieldV1[]
  portable: { format: 'mdc' | 'yaml' | 'json'; bodyField: string | null }
  componentPolicy: PortableComponentPolicyV1
}

export interface ResolvedContentContractV1 {
  format: 'ginko-content-contract'
  version: 1
  defaultLocale: string
  locales: string[]
  localeFallbacks: Record<string, string[]>
  collections: Record<string, ResolvedContentCollectionV1>
}
