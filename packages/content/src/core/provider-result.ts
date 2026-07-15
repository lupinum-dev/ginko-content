import type { ContentCacheHintInput } from './cache-hints'

const contentProviderResultMarker = Symbol.for('ginko.content.provider-result')

export interface ContentProviderResult<T = unknown> {
  readonly [contentProviderResultMarker]: true
  data: T
  cache: ContentCacheHintInput
}

export type MaybeContentProviderResult<T = unknown> = T | ContentProviderResult<T>

export const withContentCache = <T>(data: T, cache: ContentCacheHintInput): ContentProviderResult<T> => ({
  [contentProviderResultMarker]: true,
  data,
  cache
})

export const isContentProviderResult = <T = unknown>(value: unknown): value is ContentProviderResult<T> =>
  Boolean(value)
  && typeof value === 'object'
  && (value as ContentProviderResult<T>)[contentProviderResultMarker] === true
