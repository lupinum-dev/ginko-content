import { canonicalJsonBytes, type JsonValue } from '../cms-contract/hash.js'
import { portabilityError } from './errors.js'

export function parsePortableJson(source: string): JsonValue {
  let offset = 0
  const fail = (): never => { throw portabilityError('DOCUMENT_INVALID', 'portability.parse', 'Portable JSON is invalid.') }
  const whitespace = () => { while (/\s/.test(source[offset] ?? '')) offset++ }
  const string = (): string => {
    if (source[offset] !== '"') return fail()
    const start = offset++
    while (offset < source.length) {
      if (source[offset] === '\\') { offset += 2; continue }
      if (source[offset++] === '"') {
        try { return JSON.parse(source.slice(start, offset)) as string } catch { return fail() }
      }
    }
    return fail()
  }
  const value = (): JsonValue => {
    whitespace()
    const token = source[offset]
    if (token === '"') return string()
    if (token === '{') {
      offset++; whitespace()
      const output: Record<string, JsonValue> = {}
      const keys = new Set<string>()
      if (source[offset] === '}') { offset++; return output }
      while (true) {
        whitespace(); const key = string(); whitespace()
        if (keys.has(key) || source[offset++] !== ':') return fail()
        keys.add(key)
        Object.defineProperty(output, key, {
          value: value(),
          enumerable: true,
          configurable: true,
          writable: true,
        })
        whitespace()
        if (source[offset] === '}') { offset++; return output }
        if (source[offset++] !== ',') return fail()
      }
    }
    if (token === '[') {
      offset++; whitespace()
      const output: JsonValue[] = []
      if (source[offset] === ']') { offset++; return output }
      while (true) {
        output.push(value()); whitespace()
        if (source[offset] === ']') { offset++; return output }
        if (source[offset++] !== ',') return fail()
      }
    }
    for (const [literal, result] of [['true', true], ['false', false], ['null', null]] as const) {
      if (source.startsWith(literal, offset)) { offset += literal.length; return result }
    }
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?/i.exec(source.slice(offset))
    if (!match) return fail()
    offset += match[0].length
    const number = Number(match[0])
    if (!Number.isFinite(number)) return fail()
    return number
  }
  const output = value()
  whitespace()
  if (offset !== source.length) fail()
  try { canonicalJsonBytes(output) } catch { fail() }
  return output
}
