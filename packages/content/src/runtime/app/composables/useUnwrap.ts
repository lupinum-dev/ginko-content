import type { MarkdownNode, MarkdownRoot } from '../../../types/content'

function normalizeUnwrap (unwrap: boolean | string | string[]) {
  if (!unwrap || unwrap === true) {
    return []
  }

  return Array.isArray(unwrap) ? unwrap : unwrap.split(/\s+/).filter(Boolean)
}

function flatUnwrap (value: MarkdownRoot | MarkdownNode[], unwrap: boolean | string | string[] = false) {
  const tags = normalizeUnwrap(unwrap)
  const nodes = Array.isArray(value) ? value : value.children

  if (!tags.length || nodes.length !== 1) {
    return nodes
  }

  const first = nodes[0]
  if (!first?.tag || !tags.includes(first.tag)) {
    return nodes
  }

  return first.children || []
}

function unwrap (value: MarkdownRoot | MarkdownNode[], tags: boolean | string | string[] = false): MarkdownRoot {
  const nodes = flatUnwrap(value, tags)
  if (Array.isArray(value)) {
    return {
      type: 'root',
      children: nodes
    }
  }

  return {
    ...value,
    children: nodes
  }
}

export const useUnwrap = () => ({
  unwrap,
  flatUnwrap
})
