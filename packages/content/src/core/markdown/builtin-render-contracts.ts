import type { PortableComponentPolicyV1 } from '../../types/component-policy'

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
