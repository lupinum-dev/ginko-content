/**
 * Whether Comark reads an attribute string as JSON. It parses any value that
 * starts with `[` and ends with `]`, or starts with `{` and ends with `}`.
 */
export const readsAsJson = (value: unknown): boolean => {
  if (typeof value !== 'string') return false
  if (!((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']')))) return false
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

/**
 * The strings in `entries` that Comark would read as JSON, as a record. A
 * parser plugin stores them in a marker attribute, whose own value Comark
 * parses as a JSON object with these strings intact, and restores them.
 */
export const jsonLikeStrings = (entries: Iterable<readonly [string, unknown]>): Record<string, string> =>
  Object.fromEntries([...entries].filter(([, value]) => readsAsJson(value))) as Record<string, string>

/** Replace property values with `strings`, keeping the property order. */
export const restoreStrings = (props: Record<string, unknown>, strings: unknown): Record<string, unknown> => {
  if (!strings || typeof strings !== 'object' || Array.isArray(strings)) return props
  const record = strings as Record<string, unknown>
  return Object.fromEntries(Object.entries(props).map(([key, value]) =>
    [key, Object.prototype.hasOwnProperty.call(record, key) ? record[key] : value]))
}
