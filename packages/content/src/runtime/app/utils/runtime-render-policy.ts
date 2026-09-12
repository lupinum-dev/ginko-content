import type {
  PortableComponentPolicy,
  PortableComponentPolicyV2,
} from '../../../cms-contract/index'
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

  return assertPortableComponentPolicyV2({ ...policy, components })
}
