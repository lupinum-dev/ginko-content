/**
 * Reference resolution — turning a user-written identifier into a concrete
 * document in the graph.
 *
 * Three vocabularies the user might reach for:
 *
 *  - **Canonical key** — the locale-independent identity baked into the
 *    document at parse time (e.g. `guide/intro`). This is the authoritative
 *    form; everything else resolves *to* a canonical key.
 *  - **Ref** — an explicit `ref:` front-matter field. Authors use this
 *    when they want a stable short name unchained from file layout.
 *  - **Path-ish** — a locale-prefixed path (`de/leitfaden/einstieg`), a
 *    short slug, or a variant filename. `buildReferenceTargets` precomputes
 *    the full map of these shapes → canonical key so resolution is O(1).
 *
 * Contract: `resolveGraphCanonicalKey(graph, identity)` tries each
 * vocabulary in order and returns `null` if nothing matches. Callers can
 * trust that a returned canonical key exists in `graph.byCanonical`.
 */
import type { MarkdownNode, ParsedContent } from '../../types/content'
import { isMarkdownRoot, mapMarkdownNode } from '../markdown/tree'

/** Prefix recognized by `parseRefLink` for inline `$guide/intro` links in markdown. */
export const CONTENT_REF_LINK_PREFIX = '$'
const MARKDOWN_LINK_PROP_KEYS = ['href', 'to'] as const

/** Strip leading/trailing slashes so `/guide/intro/` and `guide/intro` hash to the same canonical form. */
export const normalizeReferenceValue = (value: string) => {
  const normalized = String(value)
  let start = 0
  let end = normalized.length
  while (start < end && normalized[start] === '/') start += 1
  while (end > start && normalized[end - 1] === '/') end -= 1
  return normalized.slice(start, end)
}

export const parseRefLink = (value: string) => {
  if (typeof value !== 'string' || !value.startsWith(CONTENT_REF_LINK_PREFIX)) {
    return null
  }

  const [rawRef, ...hashParts] = value.slice(CONTENT_REF_LINK_PREFIX.length).split('#')
  const ref = normalizeReferenceValue(rawRef || '')
  if (!ref) {
    return null
  }

  return {
    ref,
    hash: hashParts.length ? `#${hashParts.join('#')}` : ''
  }
}

export const collectMarkdownRefLinks = (node: unknown) => {
  const refs = new Set<string>()

  const collectProps = (props: unknown) => {
    if (!props || typeof props !== 'object') {
      return
    }

    if (Array.isArray(props)) {
      props.forEach(collectProps)
      return
    }

    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      if (MARKDOWN_LINK_PROP_KEYS.includes(key as typeof MARKDOWN_LINK_PROP_KEYS[number])) {
        if (typeof value === 'string' && parseRefLink(value)) refs.add(value)
      } else if (value && typeof value === 'object') {
        collectProps(value)
      }
    }
  }

  const visit = (current: unknown) => {
    if (!current || typeof current !== 'object') {
      return
    }

    if (isMarkdownRoot(current)) {
      current.children.forEach(visit)
      return
    }

    if ((current as MarkdownNode).type === 'element') {
      const markdownNode = current as MarkdownNode
      collectProps(markdownNode.props)

      markdownNode.children?.forEach(visit)
      return
    }

    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }

    collectProps((current as { props?: unknown }).props)

    visit((current as { children?: unknown[] }).children)
  }

  visit(node)
  return Array.from(refs)
}

export const rewriteMarkdownRefLinks = <T>(node: T, resolvedRefs: Record<string, string> = {}) => {
  const rewriteProps = (props: unknown): Record<string, unknown> | undefined => {
    if (!props || typeof props !== 'object') {
      return undefined
    }

    const rewriteValue = (value: unknown, key?: string): unknown => {
      if (
        key &&
        MARKDOWN_LINK_PROP_KEYS.includes(key as typeof MARKDOWN_LINK_PROP_KEYS[number]) &&
        typeof value === 'string' &&
        resolvedRefs[value]
      ) {
        return resolvedRefs[value]
      }
      if (Array.isArray(value)) return value.map(item => rewriteValue(item))
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
            childKey,
            rewriteValue(child, childKey),
          ]),
        )
      }
      return value
    }

    return rewriteValue(props) as Record<string, unknown>
  }

  const visit = (current: unknown): unknown => {
    if (!current || typeof current !== 'object') {
      return current
    }

    if (isMarkdownRoot(current)) {
      return {
        ...current,
        children: current.children.map(item => visit(item)) as typeof current.children
      }
    }

    if ((current as MarkdownNode).type === 'element') {
      return mapMarkdownNode(current as MarkdownNode, (markdownNode) => {
        const props = rewriteProps(markdownNode.props)
        if (props === markdownNode.props) {
          return markdownNode
        }

        return {
          ...markdownNode,
          props
        }
      })
    }

    if (Array.isArray(current)) {
      return current.map(item => visit(item))
    }

    const next = { ...(current as Record<string, unknown>) }
    const props = rewriteProps(next.props)
    if (props !== next.props) {
      next.props = props
    }

    if (Array.isArray(next.children)) {
      next.children = next.children.map(child => visit(child))
    }

    return next
  }

  return visit(node) as T
}

export interface MarkdownQuickLinkTarget {
  route: string
  params?: Record<string, string | number>
  query?: Record<string, string | number | boolean | undefined>
}

export type MarkdownQuickLinks = Record<string, Record<string, MarkdownQuickLinkTarget>>

export type ResolveQuickLinkRoute = (
  route: {
    name: string
    hash?: string
    params?: Record<string, string | number>
    query?: Record<string, string | number | boolean | undefined>
  }
) => string

export const resolveConfiguredQuickLink = (
  href: string,
  links: MarkdownQuickLinks | undefined,
  resolveRoute: ResolveQuickLinkRoute
) => {
  const parsed = parseRefLink(href)
  if (!parsed || !links) {
    return undefined
  }

  const separator = parsed.ref.indexOf('.')
  if (separator <= 0 || separator === parsed.ref.length - 1) {
    return undefined
  }

  const namespace = parsed.ref.slice(0, separator)
  const key = parsed.ref.slice(separator + 1)
  const target = links[namespace]?.[key]
  if (!target?.route) {
    return undefined
  }

  return resolveRoute({
    name: target.route,
    ...(target.params ? { params: target.params } : {}),
    ...(target.query ? { query: target.query } : {}),
    ...(parsed.hash ? { hash: parsed.hash } : {})
  })
}

export const resolveConfiguredQuickLinks = (
  hrefs: string[],
  links: MarkdownQuickLinks | undefined,
  resolveRoute: ResolveQuickLinkRoute
) => {
  return Object.fromEntries(hrefs.flatMap((href) => {
    const resolved = resolveConfiguredQuickLink(href, links, resolveRoute)
    return resolved ? [[href, resolved] as const] : []
  }))
}

export const resolveMarkdownRenderRefs = (
  node: unknown,
  resolvedRefs: Record<string, string> | undefined,
  links: MarkdownQuickLinks | undefined,
  resolveRoute: ResolveQuickLinkRoute
) => {
  const quickRefs = resolveConfiguredQuickLinks(collectMarkdownRefLinks(node), links, resolveRoute)
  const concreteContentRefs = Object.fromEntries(
    Object.entries(resolvedRefs || {}).filter(([href, value]) => value && value !== href)
  )

  return {
    ...quickRefs,
    ...concreteContentRefs
  }
}

export const buildReferenceTargets = (
  contents: ParsedContent[],
  locales: string[] = [],
  aliasesFor?: (document: ParsedContent) => readonly string[]
) => {
  const targets = new Map<string, string>()

  for (const document of contents) {
    if (!document || document.partial || document.navigationFile) {
      continue
    }

    const fileParts = (document.file?.path || '').replace(/^\/+/, '').split('/').filter(Boolean)
    const canonicalId = typeof document.canonicalKey === 'string' && document.canonicalKey.length
      ? document.canonicalKey
      : fileParts.slice(fileParts[0] && locales.includes(fileParts[0]) ? 1 : 0).join('/').replace(/\.[^.]+$/, '')

    if (!canonicalId) {
      continue
    }

    targets.set(canonicalId, canonicalId)

    if (typeof document.ref === 'string' && document.ref.length) {
      targets.set(document.ref, canonicalId)
    }

    const normalizedPath = normalizeReferenceValue(String(document.path || ''))
    if (normalizedPath) {
      targets.set(normalizedPath, canonicalId)
    }

    if (document.locale && normalizedPath) {
      targets.set(`${document.locale}/${normalizedPath}`, canonicalId)
    }

    for (const alias of aliasesFor?.(document) || []) {
      const normalizedAlias = normalizeReferenceValue(alias)
      if (normalizedAlias) {
        targets.set(normalizedAlias, canonicalId)
      }
    }
  }

  return targets
}
