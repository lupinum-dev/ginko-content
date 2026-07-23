const GFM_ALERTS = new Set(['note', 'tip', 'important', 'warning', 'caution'])

/**
 * Normalizes parser-owned Comark metadata into the inert public AST contract.
 * Keep this deliberately narrow: authored structural props such as `as` remain
 * untouched and are rejected by the render and portability policies.
 */
export function normalizeComarkNodes(nodes: unknown[], source = ''): unknown[] {
  const componentRecords = scanComponentRecords(source)
  let recordIndex = 0

  const normalize = (node: unknown): unknown => {
    if (!Array.isArray(node)) return node

    const [tag, rawProps, ...children] = node
    const props = isRecord(rawProps) ? { ...rawProps } : rawProps
    const record = componentRecords[recordIndex]

    if (record?.tag === tag) {
      recordIndex += 1
      if (isRecord(props)) {
        for (const [name, value] of record.booleans) {
          if (props[`:${name}`] === String(value)) {
            props[name] = value
            delete props[`:${name}`]
          }
        }
      }
    }

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

type ComponentRecord = {
  tag: string
  booleans: Map<string, boolean>
}

function scanComponentRecords(source: string): ComponentRecord[] {
  const lines = source.split(/\r?\n/)
  const records: ComponentRecord[] = []
  let fence: { marker: string; length: number } | undefined

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1]![0]!
      const length = fenceMatch[1]!.length
      if (!fence) fence = { marker, length }
      else if (fence.marker === marker && length >= fence.length) fence = undefined
      continue
    }
    if (fence) continue

    const opener = /^\s*:{1,}\s*([a-z][\w-]*)\b/i.exec(line)
    if (!opener || /^\s*:{1,}\s*$/.test(line)) continue

    const record: ComponentRecord = { tag: opener[1]!, booleans: new Map() }
    const frontmatterStart = index + 1
    if ((lines[frontmatterStart] ?? '').trim() === '---') {
      for (let yamlIndex = frontmatterStart + 1; yamlIndex < lines.length; yamlIndex += 1) {
        const yamlLine = lines[yamlIndex] ?? ''
        if (yamlLine.trim() === '---') break
        const boolean = /^([a-z][\w-]*):\s*(true|false)\s*$/i.exec(yamlLine)
        if (boolean) record.booleans.set(boolean[1]!, boolean[2]!.toLowerCase() === 'true')
      }
    }
    records.push(record)
  }

  return records
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
