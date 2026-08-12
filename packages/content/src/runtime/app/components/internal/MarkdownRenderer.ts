import type { PropType, VNode } from 'vue'
import { defineComponent, getCurrentInstance, h } from 'vue'
import type { MarkdownNode, MarkdownRoot } from '../../../../types/content'
import { kebabCase, pascalCase } from 'scule'
import { HTML_TAGS } from '../../../../core/markdown/html-tags.js'
import { localizeLinkProps } from '../../../../features/localization/links'
import {
  assertPublicMarkdownAst,
  type PortableComponentPolicyV1,
} from '../../../../cms-contract/index'

function parsePropValue (value: string) {
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function localizeMarkdownNodeProps (
  props: Record<string, any>,
  locale?: string,
  defaultLocale?: string,
  locales: string[] = []
) {
  if (!locale || props == null || Object.keys(props).length === 0) {
    return props
  }

  const localizedProps = structuredClone(props) as Record<string, unknown>
  localizeLinkProps(localizedProps, locale, defaultLocale, locales)
  return localizedProps
}

function resolveVueComponent (
  name: string,
  components: Record<string, any>,
  registry: Record<string, any>,
  fallbacks: Record<string, any>,
  prose: boolean | undefined,
  seen = new Set<string>()
): string | Record<string, any> | null {
  if (seen.has(name)) {
    return null
  }

  seen.add(name)
  const candidates = [
    name,
    pascalCase(name),
    kebabCase(name)
  ]

  if (prose !== false) {
    candidates.unshift(`Prose${pascalCase(name)}`)
  }

  for (const candidate of candidates) {
    const explicit = components[candidate]
    if (explicit) {
      if (typeof explicit === 'string' && explicit !== candidate && !HTML_TAGS.has(explicit)) {
        return resolveVueComponent(explicit, components, registry, fallbacks, prose, seen) || explicit
      }

      return explicit
    }
  }

  for (const candidate of candidates) {
    const registered = registry[candidate]
    if (registered) {
      return registered
    }
  }

  for (const candidate of candidates) {
    const fallback = fallbacks[candidate]
    if (fallback) {
      return fallback
    }
  }

  return null
}

function renderNode (
  node: MarkdownNode,
  options: {
    components: Record<string, any>
    registry: Record<string, any>
    fallbacks: Record<string, any>
    prose: boolean | undefined
    locale?: string
    defaultLocale?: string
    locales: string[]
  },
  key?: string | number,
  parent?: MarkdownNode
): VNode | string | null {
  if (node.type === 'text') {
    return node.value || ''
  }

  const tag = node.tag
  if (!tag) {
    return null
  }

  const nodeProps = localizeMarkdownNodeProps(
    node.props || {},
    options.locale,
    options.defaultLocale,
    options.locales
  )
  const children = node.children || []

  let component: any = tag
  if (parent?.tag === 'pre') {
    component = tag
  } else {
    const resolvedAs = typeof nodeProps.as === 'string'
      ? resolveVueComponent(nodeProps.as, options.components, options.registry, options.fallbacks, options.prose)
      : null
    const resolvedComponent = resolvedAs || resolveVueComponent(tag, options.components, options.registry, options.fallbacks, options.prose)
    if (resolvedComponent) {
      component = resolvedComponent
    } else if (HTML_TAGS.has(tag)) {
      component = tag
    }
  }

  const props: Record<string, any> = {}
  for (const propKey in nodeProps) {
    if (propKey === '$') {
      continue
    }

    if (propKey === 'className') {
      props.class = nodeProps[propKey]
    } else if (propKey.startsWith(':') && typeof nodeProps[propKey] === 'string') {
      props[propKey.slice(1)] = parsePropValue(nodeProps[propKey])
    } else {
      props[propKey] = nodeProps[propKey]
    }
  }

  if (key !== undefined) {
    props.key = key
  }

  if (component?.props?.__node || component?.__asyncResolved?.props?.__node) {
    props.__node = node
  }

  if (children.length === 0) {
    return h(component, props)
  }

  const slots: Record<string, () => Array<VNode | string>> = {}
  const regularChildren: Array<VNode | string> = []

  for (let index = 0; index < children.length; index++) {
    const child = children[index]
    if (child == null) {
      continue
    }

    const childTag = child.tag
    const childProps = child.props || {}

    if (childTag === 'template') {
      const slotName = typeof childProps.name === 'string'
        ? childProps.name
        : Object.keys(childProps).find(key => key.startsWith('v-slot:'))?.slice(7)

      if (slotName) {
        const slotChildren = (child.children || [])
          .map((slotChild, slotIndex) => renderNode(slotChild, options, slotIndex, node))
          .filter((slotChild): slotChild is VNode | string => slotChild !== null)

        slots[slotName] = () => slotChildren
        continue
      }
    }

    const rendered = renderNode(child, options, index, node)
    if (rendered !== null) {
      regularChildren.push(rendered)
    }
  }

  if (typeof component !== 'string' || !HTML_TAGS.has(component)) {
    if (regularChildren.length > 0) {
      slots.default = () => regularChildren
    }

    return h(component, props, slots)
  }

  return h(component, props, regularChildren)
}

export default defineComponent({
  name: 'MarkdownRenderer',
  props: {
    tree: {
      type: Object as PropType<MarkdownRoot>,
      required: true
    },
    components: {
      type: Object as PropType<Record<string, any>>,
      default: () => ({})
    },
    fallbackComponents: {
      type: Object as PropType<Record<string, any>>,
      default: () => ({})
    },
    prose: {
      type: Boolean as PropType<boolean | undefined>,
      default: undefined
    },
    tag: {
      type: String,
      default: 'div'
    },
    class: {
      type: [String, Array, Object],
      default: undefined
    },
    dataContentId: {
      type: String,
      default: undefined
    },
    locale: {
      type: String,
      default: undefined
    },
    defaultLocale: {
      type: String,
      default: undefined
    },
    locales: {
      type: Array as PropType<string[]>,
      default: () => []
    },
    renderPolicy: {
      type: Object as PropType<PortableComponentPolicyV1>,
      default: () => ({ components: {} })
    }
  },
  setup (props) {
    const registry = getCurrentInstance()?.appContext?.components || {}
    const attrs = getCurrentInstance()?.attrs || {}

    return () => {
      assertPublicMarkdownAst(props.tree, props.renderPolicy)
      const children = (props.tree.children || [])
        .map((node, index) => renderNode(node, {
          components: props.components,
          registry,
          fallbacks: props.fallbackComponents,
          prose: props.prose,
          locale: props.locale,
          defaultLocale: props.defaultLocale,
          locales: props.locales
        }, index))
        .filter((child): child is VNode | string => child !== null)

      return h(props.tag, {
        class: props.class,
        'data-content-id': props.dataContentId,
        ...attrs
      }, children)
    }
  }
})
