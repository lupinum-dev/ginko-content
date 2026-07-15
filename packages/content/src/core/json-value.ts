/**
 * The canonical JSON value model.
 *
 * Every post-schema document value — from every provider, in dev and in
 * build — must be one of the values below. This is the single recursive
 * validator used by every entry point that admits a document into the
 * content graph:
 *
 *  - `storage/validation.ts` (`validateDocumentJsonPurity`), called right
 *    after collection-schema parsing and before graph insertion, for both
 *    dev and build (the Nitro ingest pipeline runs in both);
 *  - `runtime/server/provider-document.ts` (`normalizeProviderDocument`),
 *    the seam every third-party provider document passes through;
 *  - `core/content/snapshot.ts` (`buildContentSnapshot`), as a cheap
 *    defensive re-assertion before persisting the snapshot artifact.
 *
 * Nothing here throws — callers decide how to report `JsonPurityViolation[]`.
 */

/** A value that survives `JSON.stringify`/`JSON.parse` unchanged. */
export type JsonValue =
  | null
  | string
  | boolean
  | number
  | JsonValue[]
  | { [key: string]: JsonValue }

export interface JsonPurityViolation {
  /** JSONPath-ish pointer, e.g. `$.publishedAt` or `$.tags[2]`. */
  path: string
  /** Human-readable reason, including the offending type and a fix. */
  reason: string
}

const isPlainObject = (value: object) => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const describeSymbolKey = (symbol: symbol) =>
  `[${String(symbol)}] (symbol-keyed property)`

/**
 * Recursively collect every non-JSON value under `value`, annotating each
 * with a JSONPath-ish `path` and an actionable `reason`.
 *
 * `ancestors` holds only the objects on the current traversal path, not every
 * visited object: a shared (non-circular) reference is valid JSON — stringify
 * duplicates it — so only true cycles are flagged.
 */
export function collectJsonPurityViolations (
  value: unknown,
  path = '$',
  ancestors: WeakSet<object> = new WeakSet(),
  violations: JsonPurityViolation[] = []
): JsonPurityViolation[] {
  if (value === null) {
    return violations
  }

  if (value === undefined) {
    violations.push({ path, reason: 'is `undefined`; omit the property (or use `null`) instead' })
    return violations
  }

  const type = typeof value

  if (type === 'string' || type === 'boolean') {
    return violations
  }

  if (type === 'number') {
    if (!Number.isFinite(value as number)) {
      violations.push({ path, reason: `is a non-finite number (${String(value)}); JSON has no NaN/Infinity — store a finite number or a string` })
    }
    return violations
  }

  if (type === 'bigint') {
    violations.push({ path, reason: 'is a bigint; store a string or a finite number instead' })
    return violations
  }

  if (type === 'function') {
    violations.push({ path, reason: 'is a function; functions cannot be stored as content values' })
    return violations
  }

  if (type === 'symbol') {
    violations.push({ path, reason: 'is a symbol; store a string instead' })
    return violations
  }

  if (type !== 'object') {
    violations.push({ path, reason: `has unsupported type "${type}"` })
    return violations
  }

  const obj = value as object

  if (obj instanceof Date) {
    violations.push({
      path,
      reason: 'is a Date instance; use fields.date() (output: "YYYY-MM-DD") or fields.datetime() '
        + '(output: a normalized UTC ISO 8601 string) and store the resulting string, not a Date'
    })
    return violations
  }

  if (obj instanceof Map) {
    violations.push({ path, reason: 'is a Map instance; store a plain object, or an array of [key, value] pairs, instead' })
    return violations
  }

  if (obj instanceof Set) {
    violations.push({ path, reason: 'is a Set instance; store an array instead' })
    return violations
  }

  if (obj instanceof RegExp) {
    violations.push({ path, reason: 'is a RegExp instance; store its string source (and flags, if needed) instead' })
    return violations
  }

  if (ArrayBuffer.isView(obj) || obj instanceof ArrayBuffer) {
    violations.push({ path, reason: 'is a binary buffer/typed array; store a plain array of numbers or a string instead' })
    return violations
  }

  if (ancestors.has(obj)) {
    violations.push({ path, reason: 'is a circular reference; JSON does not support cycles' })
    return violations
  }
  ancestors.add(obj)

  try {
    // Enumerable symbol-keyed properties are silently dropped by
    // `JSON.stringify` on both arrays and plain objects, so the rejection
    // must run before either container branch returns.
    for (const symbol of Object.getOwnPropertySymbols(obj)) {
      if (Object.prototype.propertyIsEnumerable.call(obj, symbol)) {
        violations.push({ path: `${path}${describeSymbolKey(symbol)}`, reason: 'is a symbol-keyed property; symbol keys are dropped by JSON and must not carry data' })
      }
    }

    if (Array.isArray(obj)) {
      for (let index = 0; index < obj.length; index += 1) {
        if (!(index in obj)) {
          violations.push({ path: `${path}[${index}]`, reason: 'is an array hole; arrays must not contain holes' })
          continue
        }
        collectJsonPurityViolations((obj as unknown[])[index], `${path}[${index}]`, ancestors, violations)
      }
      return violations
    }

    if (!isPlainObject(obj)) {
      const ctorName = (obj as { constructor?: { name?: string } }).constructor?.name
      violations.push({ path, reason: `is a "${ctorName || 'non-plain object'}" class instance; store a plain object instead` })
      return violations
    }

    for (const [key, child] of Object.entries(obj)) {
      collectJsonPurityViolations(child, `${path}.${key}`, ancestors, violations)
    }
    return violations
  } finally {
    ancestors.delete(obj)
  }
}

/** Join violations into a single `path: reason; path: reason; ...` string. */
export const formatJsonPurityViolations = (violations: JsonPurityViolation[]): string =>
  violations.map(violation => `${violation.path}: ${violation.reason}`).join('; ')

/** True when `value` is already JSON-pure (no violations). */
export const isJsonPure = (value: unknown): boolean =>
  collectJsonPurityViolations(value).length === 0
