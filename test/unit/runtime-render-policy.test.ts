import { describe, expect, it } from 'vitest'
import type { PortableComponentPolicyV2 } from '../../packages/content/src/types/component-policy'
import { assertPortableComponentPolicyV2 } from '../../packages/content/src/cms-contract/validate'
import { BUILTIN_MARKDOWN_RENDER_CONTRACTS } from '../../packages/content/src/core/markdown/builtin-render-contracts'
import { withMarkdownPluginComponentPolicy } from '../../packages/content/src/module/markdown-plugin-templates'
import { restoreRuntimeRenderPolicy } from '../../packages/content/src/runtime/app/utils/runtime-render-policy'

const authored: PortableComponentPolicyV2 = {
  version: 2,
  components: {
    badge: {
      kind: 'inline', props: { title: { types: ['string'], required: false, allowedValues: null } },
      slots: ['default'], allowedParents: null, allowedChildren: null, media: null,
    },
  },
}

const configured = () => withMarkdownPluginComponentPolicy(authored,
  Object.entries(BUILTIN_MARKDOWN_RENDER_CONTRACTS).map(([name, builtin]) => ({
    name, parserPath: `comark/plugins/${name}`,
    renderer: { path: `@comark/vue/plugins/${name}`, exportName: name, ...builtin },
  })))

// Model Nuxt's JSON/runtime-config boundary, where nullable fields become ''.
const serialized = () => JSON.parse(JSON.stringify(configured(), (_key, value) => value === null ? '' : value))

describe('runtime V2 render policy', () => {
  it('restores authored and enabled math/mermaid policies without mutating input', () => {
    const input = serialized()
    const before = structuredClone(input)
    expect(restoreRuntimeRenderPolicy(input)).toEqual(configured())
    expect(input).toEqual(before)
  })

  it('keeps built-in names forbidden in authored policies', () => {
    expect(() => assertPortableComponentPolicyV2(configured())).toThrow('conflicts after canonicalization')
  })

  it.each(['ginko-math', 'ginko-mermaid'])('rejects altered parser-owned %s policy', (name) => {
    const input = serialized()
    input.components[name].slots = ['default']
    expect(() => restoreRuntimeRenderPolicy(input)).toThrow('Invalid built-in render policy')
  })

  it('still validates authored policy fields strictly', () => {
    const input = serialized()
    input.components.badge.props.title.types = ['unknown']
    expect(() => restoreRuntimeRenderPolicy(input)).toThrow()
  })
})
