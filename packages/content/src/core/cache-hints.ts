import type { ContentCacheHint, ContentCacheHintInput } from '../public/provider'

const normalizeStringList = (values: unknown[] | undefined, normalize: (value: string) => string) =>
  Array.from(new Set((values || [])
    .filter((value): value is string => typeof value === 'string')
    .map(value => normalize(value.trim()))
    .filter(Boolean)))

const normalizePath = (path: string) => {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return normalized.replace(/\/{2,}/g, '/')
}

const normalizeSeconds = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined

const normalizeLastModified = (value: unknown) => {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date : undefined
  }

  return undefined
}

export const normalizeContentCacheHint = (hint: ContentCacheHint): ContentCacheHint => {
  const tags = normalizeStringList(hint.tags, value => value)
  const paths = normalizeStringList(hint.paths, normalizePath)
  const maxAge = normalizeSeconds(hint.maxAge)
  const swr = normalizeSeconds(hint.swr)
  const lastModified = normalizeLastModified(hint.lastModified)
  const etag = typeof hint.etag === 'string' && hint.etag.trim() ? hint.etag.trim() : undefined

  return {
    ...(tags.length ? { tags } : {}),
    ...(paths.length ? { paths } : {}),
    ...(typeof maxAge === 'number' ? { maxAge } : {}),
    ...(typeof swr === 'number' ? { swr } : {}),
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {})
  }
}

export const mergeContentCacheHints = (
  current: ContentCacheHint | false | undefined,
  next: ContentCacheHintInput | undefined
): ContentCacheHint | false | undefined => {
  if (current === false || next === false) {
    return false
  }

  if (!next) {
    return current
  }

  const left = normalizeContentCacheHint(current || {})
  const right = normalizeContentCacheHint(next)
  const tags = normalizeStringList([...(left.tags || []), ...(right.tags || [])], value => value)
  const paths = normalizeStringList([...(left.paths || []), ...(right.paths || [])], normalizePath)
  const maxAge = [left.maxAge, right.maxAge].filter((value): value is number => typeof value === 'number')
  const swr = [left.swr, right.swr].filter((value): value is number => typeof value === 'number')
  const lastModified = [left.lastModified, right.lastModified]
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0]

  return {
    ...(tags.length ? { tags } : {}),
    ...(paths.length ? { paths } : {}),
    ...(maxAge.length ? { maxAge: Math.min(...maxAge) } : {}),
    ...(swr.length ? { swr: Math.min(...swr) } : {}),
    ...(right.etag || left.etag ? { etag: right.etag || left.etag } : {}),
    ...(lastModified ? { lastModified } : {})
  }
}
