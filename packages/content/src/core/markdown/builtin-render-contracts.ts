import type { PortableComponentPolicyV1, PortableComponentPolicyV2 } from '../../types/component-policy'

type ComponentPolicy = PortableComponentPolicyV1['components'][string]

/** Framework-neutral public shapes emitted by configured built-in parsers. */
export const BUILTIN_MARKDOWN_RENDER_CONTRACTS = {
  math: {
    tag: 'ginko-math',
    componentPolicy: {
      kind: 'inline',
      props: {
        class: { type: 'string', required: true },
        content: { type: 'string', required: true }
      },
      slots: [],
      media: null
    } satisfies ComponentPolicy
  },
  mermaid: {
    tag: 'ginko-mermaid',
    componentPolicy: {
      kind: 'block',
      props: {
        content: { type: 'string', required: true }
      },
      slots: [],
      media: null
    } satisfies ComponentPolicy
  }
} as const

export function projectBuiltinPolicyV2(
  component: PortableComponentPolicyV1['components'][string]
): PortableComponentPolicyV2['components'][string] {
  const props: PortableComponentPolicyV2['components'][string]['props'] = {}
  for (const [name, prop] of Object.entries(component.props)) {
    props[name] = {
      types: prop.type === 'json'
        ? ['string', 'number', 'boolean', 'json']
        : [prop.type],
      required: prop.required,
      allowedValues: null
    }
  }
  return {
    kind: component.kind,
    props,
    slots: [...component.slots],
    allowedParents: null,
    allowedChildren: null,
    media: component.media ? { ...component.media } : null
  }
}
