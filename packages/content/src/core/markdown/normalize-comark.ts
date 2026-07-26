const GFM_ALERTS = new Set(['note', 'tip', 'important', 'warning', 'caution'])

/**
 * Normalizes parser-owned Comark metadata into the inert public AST contract.
 * Keep this deliberately narrow: authored structural props such as `as` remain
 * untouched and are rejected by the render and portability policies.
 */
export function normalizeComarkNodes(nodes: unknown[]): unknown[] {
  const normalize = (node: unknown): unknown => {
    if (!Array.isArray(node)) return node

    const [tag, rawProps, ...children] = node
    const props = isRecord(rawProps) ? { ...rawProps } : rawProps
    if (
      tag === 'blockquote' &&
      isRecord(props) &&
      typeof props.as === 'string' &&
      GFM_ALERTS.has(props.as.toLowerCase())
    ) {
      props['data-alert'] = props.as.toLowerCase()
      delete props.as
    }

    return [tag, props, ...children.map(normalize)]
  }

  return nodes.map(normalize)
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
