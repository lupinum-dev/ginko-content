import type {
  PortableComponentPolicy,
  PortableComponentPolicyV2,
} from '../../../cms-contract/index'
import { BUILTIN_MARKDOWN_RENDER_CONTRACTS, projectBuiltinPolicyV2 } from '../../../core/markdown/builtin-render-contracts'
import { canonicalJsonBytes, type JsonValue } from '../../../cms-contract/hash'
import { assertPortableComponentPolicyV2 } from '../../../cms-contract/index'

// Nuxt's public runtime-config serializer represents nested null values as an
// empty string. Restore only policy fields whose schema explicitly permits
// null before the strict renderer validates content against the policy.
const restoreRuntimeNull = <Value>(value: Value): Value =>
  (value === '' ? null : value) as Value

export function restoreRuntimeRenderPolicy (
  policy: PortableComponentPolicy
): PortableComponentPolicy {
  if (!('version' in policy) || policy.version !== 2) return policy

  const components = Object.fromEntries(
    Object.entries(policy.components).map(([name, component]) => [
      name,
      (() => {
        const media = restoreRuntimeNull(component.media)
        return {
          ...component,
          props: Object.fromEntries(
            Object.entries(component.props).map(([propName, prop]) => [
              propName,
              { ...prop, allowedValues: restoreRuntimeNull(prop.allowedValues) }
            ])
          ),
          allowedParents: restoreRuntimeNull(component.allowedParents),
          allowedChildren: restoreRuntimeNull(component.allowedChildren),
          media: media === null
            ? null
            : {
                ...media,
                altProp: restoreRuntimeNull(media.altProp),
                titleProp: restoreRuntimeNull(media.titleProp),
                filenameProp: restoreRuntimeNull(media.filenameProp)
              }
        }
      })()
    ])
  ) as PortableComponentPolicyV2['components']

  let authored = components
  for (const builtin of Object.values(BUILTIN_MARKDOWN_RENDER_CONTRACTS)) {
    const component = authored[builtin.tag]
    if (!component) continue
    // Runtime configuration may contain the exact parser-owned contract. These
    // reserved names remain forbidden at the authored/portable policy boundary.
    const actual = canonicalJsonBytes(component as unknown as JsonValue)
    const expected = canonicalJsonBytes(projectBuiltinPolicyV2(builtin.componentPolicy) as unknown as JsonValue)
    if (actual.length !== expected.length || actual.some((byte, index) => byte !== expected[index])) {
      throw new TypeError(`Invalid built-in render policy for "${builtin.tag}".`)
    }
    const { [builtin.tag]: _builtin, ...remaining } = authored
    authored = remaining
  }
  assertPortableComponentPolicyV2({ ...policy, components: authored })
  return { ...policy, components }
}
