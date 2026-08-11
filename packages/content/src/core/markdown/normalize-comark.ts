const GFM_ALERTS = new Set(['note', 'tip', 'important', 'warning', 'caution'])
const TASK_CHECKBOX_CLASS = 'task-list-item-checkbox'
const TABLE_ALIGNMENT = /^text-align:(?:left|center|right)$/
const MAX_CODE_HIGHLIGHTS = 256
const MAX_CODE_LINE = 1_000_000

/**
 * Normalizes parser-owned Comark metadata into the inert public AST contract.
 * Keep this deliberately narrow: authored structural props such as `as` remain
 * untouched and are rejected by the render and portability policies.
 */
export function normalizeComarkNodes(nodes: unknown[]): unknown[] {
  const normalize = (node: unknown): unknown | undefined => {
    if (!Array.isArray(node)) return node

    const [tag, rawProps, ...children] = node
    // Comark represents comments as tagless tuples. They are parser metadata,
    // not authored content, and must not enter render, portable, or agent ASTs.
    if (tag === null) return undefined

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

    if (tag === 'input' && isComarkTaskCheckboxProps(props)) {
      delete props[':checked']
      delete props[':disabled']
      props.disabled = true
      if (rawProps && isRecord(rawProps) && rawProps[':checked'] === 'true') props.checked = true
    }

    return [tag, props, ...children.map(normalize).filter(isPresent)]
  }

  return nodes.map(normalize).filter(isPresent)
}

export const isNormalizedTaskCheckboxProps = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  const expected = value.checked === true
    ? ['checked', 'class', 'disabled', 'type']
    : ['class', 'disabled', 'type']
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]) &&
    value.type === 'checkbox' && value.class === TASK_CHECKBOX_CLASS && value.disabled === true
}

export const isSafeTableAlignmentStyle = (value: unknown): boolean =>
  typeof value === 'string' && TABLE_ALIGNMENT.test(value)

export const isSafeCodeHighlights = (value: unknown): boolean =>
  Array.isArray(value) && value.length <= MAX_CODE_HIGHLIGHTS && value.every(line =>
    Number.isSafeInteger(line) && Number(line) > 0 && Number(line) <= MAX_CODE_LINE,
  )

const isComarkTaskCheckboxProps = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false
  const keys = Object.keys(value).sort()
  const checked = value[':checked'] === 'true'
  const expected = checked
    ? [':checked', ':disabled', 'class', 'type']
    : [':disabled', 'class', 'type']
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]) &&
    value[':disabled'] === 'true' && value.type === 'checkbox' && value.class === TASK_CHECKBOX_CLASS
}

const isPresent = (value: unknown): value is Exclude<unknown, undefined> => value !== undefined

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
