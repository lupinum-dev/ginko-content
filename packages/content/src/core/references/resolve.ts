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

/** Strip leading/trailing slashes so `/guide/intro/` and `guide/intro` hash to the same canonical form. */
export const normalizeReferenceValue = (value: string) => String(value).replace(/^\/+|\/+$/g, '')

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
      const href = markdownNode.tag === 'a' && typeof markdownNode.props?.href === 'string'
        ? markdownNode.props.href
        : undefined

      if (href && parseRefLink(href)) {
        refs.add(href)
      }

      markdownNode.children?.forEach(visit)
      return
    }

    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }

    const href = typeof (current as { tag?: string, props?: { href?: string } }).props?.href === 'string'
      && (current as { tag?: string }).tag === 'a'
      ? (current as { props: { href: string } }).props.href
      : undefined

    if (href && parseRefLink(href)) {
      refs.add(href)
    }

    visit((current as { children?: unknown[] }).children)
  }

  visit(node)
  return Array.from(refs)
}

export const rewriteMarkdownRefLinks = <T>(node: T, resolvedRefs: Record<string, string> = {}) => {
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
        const href = typeof markdownNode.props?.href === 'string' && markdownNode.tag === 'a'
          ? markdownNode.props.href
          : undefined

        if (!href || !resolvedRefs[href]) {
          return markdownNode
        }

        return {
          ...markdownNode,
          props: {
            ...markdownNode.props,
            href: resolvedRefs[href]
          }
        }
      })
    }

    if (Array.isArray(current)) {
      return current.map(item => visit(item))
    }

    const next = { ...(current as Record<string, unknown>) }
    const href = typeof (next.props as { href?: string } | undefined)?.href === 'string'
      && next.tag === 'a'
      ? (next.props as { href: string }).href
      : undefined

    if (href && resolvedRefs[href]) {
      next.props = {
        ...(next.props as Record<string, unknown>),
        href: resolvedRefs[href]
      }
    }

    if (Array.isArray(next.children)) {
      next.children = next.children.map(child => visit(child))
    }

    return next
  }

  return visit(node) as T
}

export const buildReferenceTargets = (contents: ParsedContent[], locales: string[] = []) => {
  const targets = new Map<string, string>()

  for (const document of contents) {
    if (!document || document._partial || document._navigation) {
      continue
    }

    const fileParts = (document._file || '').replace(/^\/+/, '').split('/').filter(Boolean)
    const canonicalId = typeof document._canonicalKey === 'string' && document._canonicalKey.length
      ? document._canonicalKey
      : fileParts.slice(fileParts[0] && locales.includes(fileParts[0]) ? 1 : 0).join('/').replace(/\.[^.]+$/, '')

    if (!canonicalId) {
      continue
    }

    targets.set(canonicalId, canonicalId)

    if (typeof document.id === 'string' && document.id.length) {
      targets.set(document.id, canonicalId)
    }

    if (typeof document.ref === 'string' && document.ref.length) {
      targets.set(document.ref, canonicalId)
    }

    const normalizedPath = normalizeReferenceValue(String(document._path || ''))
    if (normalizedPath) {
      targets.set(normalizedPath, canonicalId)
    }

    if (document._locale && normalizedPath) {
      targets.set(`${document._locale}/${normalizedPath}`, canonicalId)
    }
  }

  return targets
}
