import type { MarkdownNode, MarkdownRoot, Toc } from '../../types/content'

type ComarkTupleNode = string | [string | null, Record<string, unknown>, ...ComarkTupleNode[]]

export function isMarkdownRoot (value: unknown): value is MarkdownRoot {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { type?: string }).type === 'root'
    && Array.isArray((value as { children?: unknown }).children)
  )
}

export function toMarkdownNode (node: ComarkTupleNode): MarkdownNode {
  if (typeof node === 'string') {
    return {
      type: 'text',
      value: node
    }
  }

  const [tag, props = {}, ...children] = node
  return {
    type: 'element',
    // `undefined` is not a JSON-pure value: omit `tag` entirely
    // rather than set it to `undefined` when the tuple carries no tag.
    ...(tag ? { tag } : {}),
    props: { ...props },
    children: children.map(child => toMarkdownNode(child))
  }
}

export function toMarkdownRoot (nodes: ComarkTupleNode[], toc?: Toc): MarkdownRoot {
  return {
    type: 'root',
    children: nodes.map(node => toMarkdownNode(node)),
    ...(toc ? { toc } : {})
  }
}

export function mapMarkdownNodes (
  nodes: MarkdownNode[],
  mapNode: (node: MarkdownNode) => MarkdownNode
): MarkdownNode[] {
  return nodes.map(node => mapMarkdownNode(node, mapNode))
}

export function mapMarkdownNode (
  node: MarkdownNode,
  mapNode: (node: MarkdownNode) => MarkdownNode
): MarkdownNode {
  // `undefined` is not a JSON-pure value: a text node has neither
  // `props` nor `children`, so those keys must be omitted, not set to
  // `undefined`, when the source node doesn't carry them.
  const next: MarkdownNode = {
    ...node,
    ...(node.props ? { props: { ...node.props } } : {}),
    ...(node.children ? { children: node.children.map(child => mapMarkdownNode(child, mapNode)) } : {})
  }
  return mapNode(next)
}

export function extractMarkdownText (node: MarkdownNode, ignoredTags: string[] = []): string {
  if (node.type === 'text') {
    return node.value || ''
  }

  if (ignoredTags.includes(node.tag || '')) {
    return ''
  }

  return (node.children || []).map(child => extractMarkdownText(child, ignoredTags)).join('')
}
