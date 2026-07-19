import { normalizeSiteRelativeContentPath } from './content/path'
import { collectJsonPurityViolations } from './json-value'
import type { ContentProviderRouteFact, ContentRouteRecord } from '../public/provider-contract'

export const CONTENT_ROUTE_LIMITS = Object.freeze({
  maxRouteRecordBytes: 64 * 1024,
  maxTotalRouteBytes: 32 * 1024 * 1024,
  maxSitemapImagesPerRoute: 16,
  maxSitemapImageLocationBytes: 2 * 1024,
})

export type ContentRouteRecordValidationCode = 'RESPONSE_INVALID' | 'RESULT_LIMIT_EXCEEDED'

export class ContentRouteRecordValidationError extends Error {
  readonly code: ContentRouteRecordValidationCode
  readonly field: string

  constructor(code: ContentRouteRecordValidationCode, field: string, message: string) {
    super(message)
    this.name = 'ContentRouteRecordValidationError'
    this.code = code
    this.field = field
  }
}

const utf8Bytes = (value: string) => new TextEncoder().encode(value).length
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const forbiddenProjectedKeys = ['path', 'href', 'localePath', 'alternates'] as const

const invalid = (field: string, message: string): never => {
  throw new ContentRouteRecordValidationError('RESPONSE_INVALID', field, message)
}

const oversized = (field: string, message: string): never => {
  throw new ContentRouteRecordValidationError('RESULT_LIMIT_EXCEEDED', field, message)
}

export const normalizeRawProviderRouteFact = (
  value: unknown,
  field = 'route'
): ContentProviderRouteFact => {
  if (!isRecord(value)) return invalid(field, 'returned an invalid route fact.')
  const projectedKey = forbiddenProjectedKeys.find(key => key in value)
  if (projectedKey) {
    invalid(`${field}.${projectedKey}`, `returned preprojected route field "${projectedKey}".`)
  }
  for (const key of ['collection', 'canonicalKey', 'locale', 'contentPath'] as const) {
    if (typeof value[key] !== 'string' || !value[key]) {
      return invalid(`${field}.${key}`, `returned a route fact without a non-empty ${key}.`)
    }
  }
  let contentPath: string
  try {
    contentPath = normalizeSiteRelativeContentPath(String(value.contentPath))
  } catch {
    return invalid(`${field}.contentPath`, 'violates the site-relative content route contract.')
  }
  return {
    collection: String(value.collection),
    canonicalKey: String(value.canonicalKey),
    locale: String(value.locale),
    contentPath,
  }
}

export const normalizeRawContentRouteRecord = (
  value: unknown,
  field = 'route'
): { record: ContentRouteRecord; serializedBytes: number } => {
  if (!isRecord(value)) return invalid(field, 'returned an invalid route record.')
  const violation = collectJsonPurityViolations(value)[0]
  if (violation) {
    const suffix = violation.path === '$' ? '' : violation.path.slice(1)
    return invalid(`${field}${suffix}`, `returned a non-JSON value that ${violation.reason}.`)
  }
  const serialized = JSON.stringify(value)
  const serializedBytes = utf8Bytes(serialized)
  if (serializedBytes > CONTENT_ROUTE_LIMITS.maxRouteRecordBytes) {
    oversized(field, 'returned a route record that exceeds the byte limit.')
  }

  const route = normalizeRawProviderRouteFact(value, field)
  if (value.draft !== undefined && typeof value.draft !== 'boolean') {
    invalid(`${field}.draft`, 'returned a non-boolean draft value.')
  }
  const sitemap = value.sitemap
  if (sitemap !== undefined && sitemap !== false && !isRecord(sitemap)) {
    invalid(`${field}.sitemap`, 'returned invalid sitemap metadata.')
  }
  if (isRecord(sitemap)) {
    if (sitemap.lastmod !== undefined) {
      const lastmod = sitemap.lastmod
      if (typeof lastmod !== 'string' || Number.isNaN(Date.parse(lastmod))) {
        return invalid(`${field}.sitemap.lastmod`, 'returned an invalid lastmod value.')
      }
      if (new Date(lastmod).toISOString() !== lastmod) {
        return invalid(`${field}.sitemap.lastmod`, 'returned a lastmod value that is not normalized UTC ISO.')
      }
    }
    if (sitemap.images !== undefined) {
      const images = sitemap.images
      if (!Array.isArray(images)) return invalid(`${field}.sitemap.images`, 'returned non-array sitemap images.')
      if (images.length > CONTENT_ROUTE_LIMITS.maxSitemapImagesPerRoute) {
        oversized(`${field}.sitemap.images`, 'returned too many sitemap images.')
      }
      for (const [index, image] of images.entries()) {
        if (!isRecord(image) || typeof image.loc !== 'string' || !image.loc) {
          invalid(`${field}.sitemap.images[${index}].loc`, 'returned an invalid sitemap image location.')
        }
        if (utf8Bytes(image.loc) > CONTENT_ROUTE_LIMITS.maxSitemapImageLocationBytes) {
          oversized(`${field}.sitemap.images[${index}].loc`, 'returned a sitemap image location that exceeds the byte limit.')
        }
      }
    }
  }

  return {
    record: {
      ...route,
      ...(value.draft === true ? { draft: true } : {}),
      ...(sitemap === false ? { sitemap: false } : isRecord(sitemap) ? { sitemap } : {}),
    } as ContentRouteRecord,
    serializedBytes,
  }
}
