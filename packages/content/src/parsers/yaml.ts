import { load } from 'js-yaml'
import type { ParsedContent } from '../types/content'
import { defineTransformer } from './utils'
import { stripReservedContentKeys } from './reserved'

/**
 * js-yaml's default schema resolves bare timestamp-shaped scalars
 * (`date: 2026-01-01`, `date: 2026-01-01T10:00:00Z`) to `Date` instances.
 * The canonical JSON value model never admits a `Date`, so this
 * normalizes every `Date` produced by the YAML parser to its UTC ISO 8601
 * string form *before* schema/graph — `fields.date()` further narrows an ISO
 * string down to `YYYY-MM-DD`, and untyped/data-only fields simply keep the
 * ISO string.
 */
const normalizeYamlDates = (value: unknown): unknown => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString()
  }
  if (Array.isArray(value)) {
    return value.map(normalizeYamlDates)
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, normalizeYamlDates(child)])
    )
  }
  return value
}

export default defineTransformer({
  name: 'Yaml',
  extensions: ['.yml', '.yaml'],
  parse: (id, content) => {
    const data = load(String(content)) as ParsedContent | ParsedContent[]

    // Keep array contents under `body` key
    let parsed = data
    if (Array.isArray(data)) {
      console.warn(`YAML array is not supported in ${id}, moving the array into the \`body\` key`)
      parsed = { body: data } as unknown as ParsedContent
    }

    parsed = stripReservedContentKeys(parsed as Record<string, unknown>, id) as ParsedContent
    parsed = normalizeYamlDates(parsed) as ParsedContent

    return <ParsedContent> {
      ...parsed,
      id,
      type: 'yaml'
    }
  }
})
