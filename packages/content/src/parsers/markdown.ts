import { parse } from 'comark'
import { isRelative } from 'ufo'
import type { MarkdownNode, MarkdownOptions, MarkdownParsedContent, MarkdownRoot } from '../types/content'
import { defineTransformer } from './utils'
import { generatePath } from './path-meta'
import { resolveMarkdownPlugins } from './markdown-plugins'
import { warnReservedContentKeys } from './reserved'
import { mapMarkdownNodes, toMarkdownRoot } from '../core/markdown/tree'

export default defineTransformer({
  name: 'markdown',
  extensions: ['.md'],
  parse: async (id, content, options = {}) => {
    const config = { ...(typeof options === 'object' && options !== null ? options : {}) } as MarkdownOptions
    const plugins = await resolveMarkdownPlugins(config.plugins || [])
    const tree = await parse(content as string, {
      plugins
    })

    warnReservedContentKeys(tree.frontmatter as Record<string, unknown>, id)

    const body = normalizeMarkdownBody({
      ...toMarkdownRoot(tree.nodes as any[]),
      toc: tree.meta?.toc
    })
    const excerpt = Array.isArray(tree.meta?.summary)
      ? normalizeMarkdownBody({
          ...toMarkdownRoot(tree.meta.summary as any[])
        })
      : undefined

    return <MarkdownParsedContent>{
      ...tree.frontmatter,
      description: typeof tree.frontmatter.description === 'string' ? tree.frontmatter.description : '',
      excerpt,
      body,
      type: 'markdown',
      id
    }
  }
})

function normalizeMarkdownBody (body: MarkdownRoot): MarkdownRoot {
  return {
    ...body,
    children: mapMarkdownNodes(body.children, normalizeMarkdownNode)
  }
}

function normalizeMarkdownNode (node: MarkdownNode): MarkdownNode {
  if (node.tag !== 'a') {
    return node
  }

  const href = typeof node.props?.href === 'string' ? node.props.href : undefined
  if (!href) {
    return node
  }

  return {
    ...node,
    props: {
      ...node.props,
      href: normalizeLink(href)
    }
  }
}

function normalizeLink (link: string) {
  const match = link.match(/#.+$/)
  const hash = match ? match[0] : ''
  if (link.replace(/#.+$/, '').endsWith('.md') && (isRelative(link) || (!/^https?/.test(link) && !link.startsWith('/')))) {
    const normalized = link.replace('.md' + hash, '').replace(/^\.\//, '')
    return (generatePath(normalized, { forceLeadingSlash: false }) + hash)
  }

  return link
}
