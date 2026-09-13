export interface PortableComponentPolicyV1 {
  components: Record<string, {
    kind: 'block' | 'inline'
    props: Record<string, {
      type: 'string' | 'number' | 'boolean' | 'json' | 'asset'
      required: boolean
    }>
    slots: string[]
    media: {
      sourceProp: string
      altProp: string | null
      titleProp: string | null
      filenameProp: string | null
    } | null
  }>
}

export const PORTABLE_COMPONENT_VALUE_TYPES_V2 = [
  'string',
  'number',
  'boolean',
  'json',
  'asset',
] as const

export type PortableComponentValueTypeV2 = typeof PORTABLE_COMPONENT_VALUE_TYPES_V2[number]

export interface PortableComponentPropPolicyV2 {
  types: readonly [PortableComponentValueTypeV2, ...PortableComponentValueTypeV2[]]
  required: boolean
  allowedValues: readonly (string | number | boolean)[] | null
}

export interface PortableComponentPolicyV2 {
  version: 2
  components: Record<string, {
    kind: 'block' | 'inline'
    props: Record<string, PortableComponentPropPolicyV2>
    slots: readonly string[]
    allowedParents: readonly string[] | null
    allowedChildren: readonly string[] | null
    media: {
      sourceProp: string
      altProp: string | null
      titleProp: string | null
      filenameProp: string | null
    } | null
  }>
}

export type PortableComponentPolicy = PortableComponentPolicyV1 | PortableComponentPolicyV2
