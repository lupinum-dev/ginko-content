import { defineTransformer } from '@lupinum/ginko-content/transformers'

// Proves real `content.transformers` wiring, rather than the isolated
// `transformContent` primitive, stamps a computed fact
// identically onto every markdown document, visible through both a direct
// query (`/nav`) and the transformed page's own generated route.
interface MarkdownNode {
  type?: string
  value?: string
  children?: MarkdownNode[]
}

const collectText = (node: MarkdownNode | undefined, out: string[] = []): string[] => {
  if (!node || typeof node !== 'object') return out
  if (node.type === 'text' && typeof node.value === 'string') out.push(node.value)
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectText(child, out)
  }
  return out
}

export default defineTransformer({
  name: 'route-invariants-word-count',
  extensions: ['.md'],
  transform (content) {
    const words = collectText((content as { body?: MarkdownNode }).body).join(' ').trim().split(/\s+/).filter(Boolean)
    return { ...content, wordCount: words.length } as typeof content
  }
})
