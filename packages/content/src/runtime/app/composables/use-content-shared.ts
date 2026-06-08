import { toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { hash } from 'ohash'
import type { ContentCollectionTarget } from '../../../types/query'

export type ReactiveLeaf<T> = T | MaybeRefOrGetter<T>

export type ReactiveValue<V> = V extends ((...args: never[]) => unknown) | readonly unknown[]
  ? ReactiveLeaf<V>
  : V extends object | undefined
    ? ReactiveLeaf<V> | { [P in keyof NonNullable<V>]?: ReactiveLeaf<NonNullable<V>[P]> }
    : ReactiveLeaf<V>

export type Reactive<T> = {
  [K in keyof T]: ReactiveValue<T[K]>
}

/**
 * Recursively unwrap any `Ref` / getter found in a reactive options object.
 * `by: { path: () => route.path }` is the canonical use case: the top-level
 * `by` key is a plain object, but its inner `path` is a getter that has to be
 * evaluated each time the source ref changes.
 */
const unwrapDeep = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === null || value === undefined) return value
  if (typeof value === 'function') return unwrapDeep(toValue(value as MaybeRefOrGetter<unknown>), seen)
  if (typeof value === 'object' && '__v_isRef' in (value as object)) {
    return unwrapDeep(toValue(value as MaybeRefOrGetter<unknown>), seen)
  }
  if (Array.isArray(value)) return value.map(item => unwrapDeep(item, seen))
  if (typeof value === 'object' && value.constructor === Object) {
    if (seen.has(value as object)) return value
    seen.add(value as object)
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = unwrapDeep(v, seen)
    }
    return out
  }
  return value
}

export const resolveOptions = <T extends Record<string, unknown>>(reactive: Reactive<T>): T => {
  return unwrapDeep(reactive) as T
}

export const stableKey = (prefix: string, name: string, options: unknown) => `${prefix}:${name}:${hash(options)}`

export const contentCollectionName = (handle: ContentCollectionTarget) =>
  typeof handle === 'string' ? handle : handle.name
