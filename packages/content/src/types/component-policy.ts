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
