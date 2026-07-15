import { JSON_SCHEMA, load } from 'js-yaml'

import { canonicalJsonBytes, type JsonValue } from '../cms-contract/hash.js'
import { portabilityError } from './errors.js'

export function parsePortableYaml(source: string): JsonValue {
  if (source.startsWith('\uFEFF') || [...source].some(character => {
    const code = character.codePointAt(0)!
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31)
  })) throw invalidYaml()
  for (const line of source.split(/\r?\n/)) {
    const plain = line.replace(/"(?:[^"\\]|\\.)*"/g, '')
    if (/(^|\s)(?:[&*!]|<<\s*:)/.test(plain) || /^\s*(?:[-+]?\d+(?:\.\d+)?|true|false|null)\s*:/.test(plain)) throw invalidYaml()
  }
  try {
    const value = load(source, { schema: JSON_SCHEMA }) as JsonValue
    canonicalJsonBytes(value)
    return value
  } catch {
    throw invalidYaml()
  }
}

const invalidYaml = () => portabilityError('DOCUMENT_INVALID', 'portability.parse', 'Portable YAML is invalid.')

export function serializePortableYaml(value: JsonValue, rootOrder: string[] = []): string {
  canonicalJsonBytes(value)
  return `${emit(value, 0, rootOrder)}\n`
}

function emit(value: JsonValue, depth: number, preferredOrder: string[] = []): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') return scalar(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    return value.map(item => {
      const rendered = emit(item, depth + 1)
      return `${'  '.repeat(depth)}-${isCompound(item) ? `\n${rendered}` : ` ${rendered}`}`
    }).join('\n')
  }
  const keys = Object.keys(value)
  const ordered = [...preferredOrder.filter(key => keys.includes(key)), ...keys.filter(key => !preferredOrder.includes(key)).sort()]
  if (ordered.length === 0) return '{}'
  return ordered.map(key => {
    const child = value[key]!
    const rendered = emit(child, depth + 1)
    return `${'  '.repeat(depth)}${scalar(key)}:${isCompound(child) ? `\n${rendered}` : ` ${rendered}`}`
  }).join('\n')
}

const isCompound = (value: JsonValue) => typeof value === 'object' && value !== null && (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0)
const scalar = (value: string | number | boolean | null) => {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return new TextDecoder().decode(canonicalJsonBytes(value))
}
