import { kebabCase, pascalCase } from 'scule'
import type { MarkdownNode, MarkdownRoot } from '../../types/content'
import type { AgentMarkdownContext, AgentMarkdownRenderContext } from './agent-markdown'
import {
  blockquoteMarkdown,
  cleanPropsObject,
  escapeMarkdownLinkLabel,
  getMarkdownProp,
  imageMarkdown,
  isRecord,
  jsonFenceMarkdown,
  linkMarkdown,
  xmlComponentMarkdown
} from './agent-markdown'
import { agentRawPathForRoute, normalizeAgentRoutePath } from './agent-paths'
import { pathHasLocalePrefix, prefixPathWithLocale } from '../../core/content/path'
import { isNormalizedTaskCheckboxProps } from '../../core/markdown/normalize-comark'

const textValue = (node: MarkdownNode): string => {
  if (node.type === 'text') return node.value || ''
  return (node.children || []).map(child => textValue(child)).join('')
}

const renderChildren = (node: MarkdownNode, ctx: AgentMarkdownContext) =>
  (node.children || []).map(child => renderNode(child, ctx)).join('').trim()

const block = (value: string) => value.trim() ? `${value.trim()}\n\n` : ''

const codeFenceInfo = (node: MarkdownNode) => {
  const language = typeof node.props?.language === 'string'
    ? node.props.language.replace(/[\r\n]/g, ' ').trim()
    : ''
  const filename = typeof node.props?.filename === 'string'
    ? node.props.filename.replace(/[\r\n]/g, ' ').trim()
    : ''
  return `${language}${filename ? ` [${filename.replace(/\]/g, '\\]')}]` : ''}`
}

const renderList = (node: MarkdownNode, ctx: AgentMarkdownContext, ordered = false) =>
  block((node.children || []).map((child, index) => {
    const [first, ...rest] = child.children || []
    let task = ''
    if (first?.tag === 'input' && isNormalizedTaskCheckboxProps(first.props)) {
      task = first.props?.checked === true ? '[x] ' : '[ ] '
    }
    const children = task ? rest : child.children || []
    const body = children.map(item => renderNode(item, ctx)).join('').trim().replace(/\n+/g, '\n  ')
    const prefix = ordered ? `${index + 1}.` : '-'
    return `${prefix} ${task}${body}`
  }).join('\n'))

const renderTable = (node: MarkdownNode, ctx: AgentMarkdownContext) => {
  const rows = (node.children || []).flatMap(section => section.tag === 'thead' || section.tag === 'tbody'
    ? (section.children || [])
    : [section]
  ).filter(row => row.tag === 'tr')

  if (!rows.length) return ''

  const cells = rows.map(row => (row.children || [])
    .filter(cell => cell.tag === 'th' || cell.tag === 'td')
    .map(cell => renderChildren(cell, ctx).split('|').join('\\|').trim())
  )
  const width = Math.max(...cells.map(row => row.length))
  const normalized = cells.map(row => [...row, ...Array.from({ length: width - row.length }, () => '')])
  const [head = [], ...bodyRows] = normalized
  return block([
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...bodyRows.map(row => `| ${row.join(' | ')} |`)
  ].join('\n'))
}

const renderUnknownComponentOmission = (name: string, reason?: string) =>
  `> Component omitted: \`${name}\`.\n> ${reason || 'This page contains an interactive or site-specific block that has no agent markdown serializer yet.'}`

const resolvedRefsForPage = (page: AgentMarkdownRenderContext['page']) =>
  isRecord(page.resolvedRefs) ? (page.resolvedRefs as Record<string, string>) : {}

const cleanPropsForContext = (props: unknown, ctx: Pick<AgentMarkdownRenderContext, 'page'>) =>
  Object.fromEntries(
    Object.entries(cleanPropsObject(props)).map(([key, value]) => [
      key,
      typeof value === 'string' ? resolvedRefsForPage(ctx.page)[value] || value : value
    ])
  )

const renderUnknownComponent = (node: MarkdownNode, ctx: AgentMarkdownContext) => {
  const tag = node.tag || 'component'
  const props = cleanPropsForContext(node.props, ctx)
  const children = renderChildren(node, ctx)

  if (children || Object.keys(props).length) {
    return block(xmlComponentMarkdown(tag, props, children))
  }

  return block(renderUnknownComponentOmission(tag))
}

const serializerForTag = (tag: string, ctx: AgentMarkdownContext) => {
  const markdownTags = ctx.tagAliases || {}
  const candidates = new Set([
    tag,
    pascalCase(tag),
    kebabCase(tag),
    markdownTags[tag],
    markdownTags[pascalCase(tag)],
    markdownTags[kebabCase(tag)]
  ].filter((value): value is string => Boolean(value)))

  for (const candidate of candidates) {
    const serializer = ctx.registry.get(candidate)
    if (serializer) return serializer
  }
}

const isExternalHref = (href: string) =>
  /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')

const prefixLocalizedHref = (path: string, locale: string | undefined, ctx: AgentMarkdownContext) => {
  const normalized = normalizeAgentRoutePath(path)
  if (!locale) return normalized
  if (pathHasLocalePrefix(normalized, ctx.locales)) return normalized
  return prefixPathWithLocale(normalized, locale, ctx.defaultLocale)
}

const routeMarkdownPathForHref = (href: string, ctx: AgentMarkdownContext) => {
  const resolvedHref = resolvedRefsForPage(ctx.page)[href] || href
  const currentPath = ctx.path || '/'
  const hash = resolvedHref.match(/#.*$/)?.[0] || ''
  const withoutHash = resolvedHref.replace(/#.*$/, '')
  if (!withoutHash) return resolvedHref
  if (isExternalHref(withoutHash)) return resolvedHref
  if (withoutHash.endsWith('.md')) return resolvedHref
  const target = withoutHash.startsWith('/')
    ? prefixLocalizedHref(withoutHash, ctx.locale, ctx)
    : new URL(withoutHash, `https://agent.local${normalizeAgentRoutePath(currentPath)}`).pathname
  return `${agentRawPathForRoute(target)}${hash}`
}

const renderNode = (node: MarkdownNode, ctx: AgentMarkdownContext): string => {
  if (node.type === 'text') return node.value || ''

  const tag = node.tag || ''
  const serializer = tag ? serializerForTag(tag, ctx) : undefined
  if (serializer) {
    const nodeCtx: AgentMarkdownContext = {
      ...ctx,
      prop: name => getMarkdownProp(node, name),
      props: target =>
        isRecord((target || node).props) ? ((target || node).props as Record<string, unknown>) : {},
      cleanProps: target => cleanPropsForContext((target || node).props, ctx),
      children: target => renderChildren(target || node, nodeCtx)
    }
    const rendered = serializer(node, nodeCtx)
    if (typeof rendered === 'string') return block(rendered)
  }

  // Tagless element nodes are invalid at the public boundary. Ignore them
  // defensively so legacy/corrupt ASTs cannot expose parser comment text.
  if (!tag) return ''

  if (/^h[1-6]$/.test(tag)) {
    const depth = Number(tag.slice(1))
    return block(`${'#'.repeat(Math.max(1, Math.min(6, depth)))} ${renderChildren(node, ctx)}`)
  }

  switch (tag) {
    case 'p':
      return block(renderChildren(node, ctx))
    case 'blockquote':
      return block(renderBlockquote(node, ctx))
    case 'strong':
    case 'b':
      return `**${renderChildren(node, ctx)}**`
    case 'em':
    case 'i':
      return `_${renderChildren(node, ctx)}_`
    case 'span':
      return renderChildren(node, ctx)
    case 'code':
      return `\`${node.value || textValue(node)}\``
    case 'pre':
      return block(`\`\`\`${codeFenceInfo(node)}\n${textValue(node)}\n\`\`\``)
    case 'a': {
      const href = typeof node.props?.href === 'string' ? node.props.href : ''
      const text = renderChildren(node, ctx) || href
      return href ? linkMarkdown(text, routeMarkdownPathForHref(href, ctx)) : text
    }
    case 'ul':
      return renderList(node, ctx)
    case 'ol':
      return renderList(node, ctx, true)
    case 'li':
      return renderChildren(node, ctx)
    case 'hr':
      return '---\n\n'
    case 'br':
      return '\n'
    case 'img': {
      const src = typeof node.props?.src === 'string' ? node.props.src : ''
      const alt = typeof node.props?.alt === 'string' ? node.props.alt : ''
      return src ? imageMarkdown(alt, src) : escapeMarkdownLinkLabel(alt)
    }
    case 'table':
      return renderTable(node, ctx)
    case 'thead':
    case 'tbody':
    case 'tr':
    case 'th':
    case 'td':
      return renderChildren(node, ctx)
    default:
      return renderUnknownComponent(node, ctx)
  }
}

const renderBlockquote = (node: MarkdownNode, ctx: AgentMarkdownContext) => {
  const alert = typeof node.props?.['data-alert'] === 'string' ? node.props['data-alert'] : ''
  const content = renderChildren(node, ctx)
  const value = alert
    ? `[!${alert.toUpperCase()}]\n${content}`
    : content
  return value.split('\n').map(line => `> ${line}`).join('\n')
}

/**
 * The pure agent-markdown walker: serializes a parsed markdown body to agent
 * markdown as a function of `(body, context)` alone. Every config- and
 * registry-derived input arrives on {@link AgentMarkdownRenderContext}; the
 * walker reads no module-global state, so identical inputs always produce
 * identical output.
 */
export const renderAgentMarkdownBody = (
  body: MarkdownRoot | null | undefined,
  context: AgentMarkdownRenderContext
): string => {
  if (!body?.children?.length) return ''
  const ctx: AgentMarkdownContext = {
    ...context,
    prop: () => '',
    props: node => (node ? (isRecord(node.props) ? node.props : {}) : {}),
    cleanProps: node => cleanPropsForContext(node?.props, context),
    children: node => (node ? renderChildren(node, ctx) : ''),
    renderChildren: node => renderChildren(node, ctx),
    renderNode: node => renderNode(node, ctx),
    blockquote: value => blockquoteMarkdown(value),
    jsonFence: value => jsonFenceMarkdown(value),
    link: (label, href) => linkMarkdown(label, href),
    omitted: (name, reason) => renderUnknownComponentOmission(name, reason),
    xmlComponent: (name, props, children) => xmlComponentMarkdown(name, props, children)
  }
  return body.children.map(node => renderNode(node, ctx)).join('').trim()
}
