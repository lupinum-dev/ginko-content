import { kebabCase, pascalCase } from 'scule'
import type { AsyncComponentLoader } from 'vue'
import htmlTags from './html-tags.js'

type ContentBodyNode = {
  type?: string
  tag?: string
  props?: Record<string, unknown>
  children?: ContentBodyNode[]
}

type Renderable = {
  render?: (props: Record<string, unknown>) => unknown
  ssrRender?: (props: Record<string, unknown>) => unknown
}

export interface ContentComponentCatalog {
  globalComponents?: string[]
  localComponents?: string[]
  localComponentLoaders?: Record<string, AsyncComponentLoader>
  componentRegistry?: Record<string, unknown>
}

export function loadContentComponentEntries (
  node: ContentBodyNode | null | undefined,
  tags: Record<string, string>
): Array<[string, unknown]> {
  if (!node) {
    return []
  }

  if (node.type === 'text' || node.tag === 'binding') {
    return []
  }

  if (node.type === 'root') {
    return (node.children || []).flatMap(child => loadContentComponentEntries(child, tags))
  }

  const tag = node.tag
  if (!tag) {
    return []
  }

  const mappedTag = typeof node.props?.__ignoreMap === 'undefined'
    ? tags[tag] || tags[pascalCase(tag)] || tags[kebabCase(tag)] || tag
    : tag
  const components: Array<[string, unknown]> = []

  if (!htmlTags.includes(mappedTag as never)) {
    components.push([tag, mappedTag])
  }

  for (const child of (node.children || [])) {
    components.push(...loadContentComponentEntries(child, tags))
  }

  return components
}

export async function resolveVueContentComponent (
  component: string | Renderable | unknown,
  catalog: ContentComponentCatalog
) {
  let resolvedComponent = component

  if (typeof component === 'string') {
    if (htmlTags.includes(component as never)) {
      return component
    }

    const pascalName = pascalCase(component)
    const candidates = new Set([component, pascalName, kebabCase(component)])

    if (catalog.globalComponents?.includes(pascalName)) {
      for (const candidate of candidates) {
        const resolved = catalog.componentRegistry?.[candidate]
        if (resolved && typeof resolved !== 'string') {
          resolvedComponent = resolved
          break
        }
      }
    } else if (catalog.localComponents?.includes(pascalName)) {
      const loader = catalog.localComponentLoaders?.[pascalName]
      resolvedComponent = loader ? await loader() : undefined
    }

    if (typeof resolvedComponent === 'string') {
      return resolvedComponent
    }
  }

  return resolvedComponent as Renderable | undefined
}

export async function resolveDocumentContentComponents (
  body: ContentBodyNode | null | undefined,
  options: {
    tags: Record<string, string>
    catalog: ContentComponentCatalog
  }
) {
  if (!body) {
    return {}
  }

  const components = Array.from(new Map(
    loadContentComponentEntries(body, options.tags).map(([tag, component]) => [`${tag}:${String(component)}`, [tag, component] as [string, unknown]])
  ).values())

  const resolvedEntries = await Promise.all(components.map(async ([tag, component]) => {
    if (typeof component === 'object' && component) {
      return [tag, component]
    }

    return [tag, await resolveVueContentComponent(component as string, options.catalog)]
  }))

  return Object.fromEntries(resolvedEntries)
}
