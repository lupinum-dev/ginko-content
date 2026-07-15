import { z } from 'zod'
import { PORTABLE_CONTENT_LIMITS } from './limits.js'

const wireLimits = {
  depth: 64,
  nodes: 100_000,
  containers: 20_000,
  arrayItems: 2_000,
  objectKeys: 256,
  stringBytes: 1024 * 1024,
  totalStringBytes: 8 * 1024 * 1024,
} as const
const encoder = new TextEncoder()

const wireLimitError = (reason: string) => new TypeError(`CMS wire value exceeds its bounded ${reason} limit.`)

function assertBoundedWireValue(root: unknown): void {
  type Frame = { value: unknown; depth: number; exit?: object }
  const stack: Frame[] = [{ value: root, depth: 0 }]
  const ancestors = new WeakSet<object>()
  let nodes = 0
  let containers = 0
  let totalStringBytes = 0

  const countString = (value: string) => {
    if (value.length > wireLimits.stringBytes) throw wireLimitError('string')
    const bytes = encoder.encode(value).byteLength
    if (bytes > wireLimits.stringBytes) throw wireLimitError('string')
    totalStringBytes += bytes
    if (totalStringBytes > wireLimits.totalStringBytes) throw wireLimitError('total string')
  }

  while (stack.length) {
    const frame = stack.pop()!
    if (frame.exit) {
      ancestors.delete(frame.exit)
      continue
    }
    nodes += 1
    if (nodes > wireLimits.nodes) throw wireLimitError('node count')
    if (frame.depth > wireLimits.depth) throw wireLimitError('depth')

    const value = frame.value
    if (typeof value === 'string') {
      countString(value)
      continue
    }
    if (value === null || typeof value === 'boolean') continue
    if (typeof value === 'number' && Number.isFinite(value)) continue
    if (!value || typeof value !== 'object') throw new TypeError('CMS wire value must contain bounded JSON data only.')

    const object = value as object
    if (ancestors.has(object)) throw new TypeError('CMS wire value must not contain cycles.')
    const prototype = Object.getPrototypeOf(object)
    if (Array.isArray(value)) {
      if (prototype !== Array.prototype || value.length > wireLimits.arrayItems) throw wireLimitError('array container')
    } else if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('CMS wire value must contain plain JSON objects only.')
    }

    containers += 1
    if (containers > wireLimits.containers) throw wireLimitError('container count')
    ancestors.add(object)
    stack.push({ value: null, depth: frame.depth, exit: object })

    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index--) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError('CMS wire arrays must not contain holes.')
        }
        stack.push({ value: value[index], depth: frame.depth + 1 })
      }
      continue
    }

    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Object.keys(descriptors)
    if (keys.length > wireLimits.objectKeys) throw wireLimitError('object container')
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index]!
      const descriptor = descriptors[key]!
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError('CMS wire objects must contain enumerable data properties only.')
      }
      countString(key)
      stack.push({ value: descriptor.value, depth: frame.depth + 1 })
    }
  }
}

const boundedWireValueSchema: z.ZodType<unknown> = z.custom((value) => {
  try {
    assertBoundedWireValue(value)
    return true
  } catch {
    return false
  }
}, 'Expected bounded JSON data.')
const jsonValueSchema = boundedWireValueSchema
const nonEmptyString = z.string().min(1)
const isoDate = z.string().refine((value) => {
  try { return new Date(value).toISOString() === value } catch { return false }
}, 'Expected a normalized UTC ISO date.')
const sitePath = z.string().refine((value) => {
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('?') || value.includes('#') || value.includes('\\')) return false
  try {
    const parsed = new URL(value, 'https://ginko.invalid')
    return parsed.origin === 'https://ginko.invalid' && !parsed.username && !parsed.password
  } catch { return false }
}, 'Expected a credential-free site-relative path without query or fragment.')

const routeSchema = z.object({
  slug: z.string(), path: sitePath, href: sitePath.optional(), locale: nonEmptyString,
  source: z.literal('published')
}).strict().superRefine((route, ctx) => {
  if (route.path === `/${route.locale}` || route.path.startsWith(`/${route.locale}/`)) {
    ctx.addIssue({
      code: 'custom', path: ['path'],
      message: 'CMS route.path must not contain a site-locale prefix.'
    })
  }
})
const localeResolutionSchema = z.object({
  requested: nonEmptyString, resolved: nonEmptyString,
  policy: z.enum(['strict', 'transparent']),
  fallbacks: z.object({ fields: z.array(z.object({ path: nonEmptyString, from: nonEmptyString }).strict()) }).strict()
}).strict()
const translationSchema = z.object({
  locale: nonEmptyString, route: routeSchema, status: z.enum(['published', 'missing'])
}).strict()
const projectedDataKeys = new Set(['path', 'href', 'localePath', 'alternates', 'resolved'])
const publicDataSchema = z.record(z.string(), jsonValueSchema).superRefine((value, ctx) => {
  for (const key of projectedDataKeys) {
    if (key in value) ctx.addIssue({
      code: 'custom', path: [key],
      message: `CMS public data must not supply Content-owned projected field "${key}".`
    })
  }
})
const publicAssetFactSchema = z.object({
  fieldPath: z.string().regex(/^(?:data|bodyAst)(?:\.[A-Za-z0-9_-]+|\[\d+\])*$/).refine(
    (value) => !value.split('[').join('.').split(']').join('.').split('.').some(
      (part) => ['__proto__', 'prototype', 'constructor'].includes(part)
    ),
    'Asset field path contains a forbidden property.'
  ),
  assetId: nonEmptyString,
  url: z.string().url().refine((value) => {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
  }, 'Expected a credential-free HTTPS asset URL.'),
  expiresAt: z.number().int().positive().nullable(),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  bytes: z.number().int().positive().max(PORTABLE_CONTENT_LIMITS.assetBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
}).strict()

const cmsPublicEntryWireObjectSchema = z.object({
  id: nonEmptyString, collection: nonEmptyString, route: routeSchema,
  translations: z.array(translationSchema), locale: localeResolutionSchema,
  title: z.string(), data: publicDataSchema, bodyAst: jsonValueSchema.optional(),
  toc: jsonValueSchema.optional(), publishedAt: isoDate, updatedAt: isoDate,
  revision: nonEmptyString, stableId: nonEmptyString,
  assetFacts: z.array(publicAssetFactSchema).max(100)
}).strict()
export const cmsPublicEntryWireSchema = boundedWireValueSchema.pipe(cmsPublicEntryWireObjectSchema)
export type CmsPublicEntryWire = z.infer<typeof cmsPublicEntryWireSchema>
export interface CmsNavNodeWire {
  entry: CmsPublicEntryWire
  children: CmsNavNodeWire[]
}
const pageInfoSchema = z.object({
  hasNextPage: z.boolean(), endCursor: z.string().min(1).nullable()
}).strict().superRefine((value, ctx) => {
  if (value.hasNextPage && value.endCursor === null) ctx.addIssue({ code: 'custom', path: ['endCursor'], message: 'A next page requires an opaque cursor.' })
  if (!value.hasNextPage && value.endCursor !== null) ctx.addIssue({ code: 'custom', path: ['endCursor'], message: 'A completed page must have a null cursor.' })
})
const pageBase = {
  collection: nonEmptyString, locale: localeResolutionSchema,
  breadcrumbs: z.array(z.object({ title: z.string(), route: routeSchema, routable: z.boolean() }).strict())
}
export const cmsPageWireResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('found'), page: cmsPublicEntryWireSchema, ...pageBase,
    seo: z.object({
      title: z.string(), description: z.string(), canonical: sitePath,
      alternates: z.array(z.object({ locale: nonEmptyString, hreflang: nonEmptyString, route: routeSchema }).strict()),
      xDefault: routeSchema.nullable()
    }).strict()
  }).strict(),
  z.object({
    status: z.literal('redirect'), page: z.null(), ...pageBase, seo: z.null(),
    redirectTo: routeSchema, redirectedFrom: sitePath
  }).strict(),
  z.object({ status: z.literal('not-found'), page: z.null(), ...pageBase, seo: z.null() }).strict()
])
export const cmsListWireResultSchema = z.object({
  entries: z.array(cmsPublicEntryWireSchema).max(100), pageInfo: pageInfoSchema,
  collection: nonEmptyString, locale: localeResolutionSchema
}).strict()
const navNodeSchema: z.ZodType<CmsNavNodeWire> = z.lazy(() =>
  z.object({ entry: cmsPublicEntryWireSchema, children: z.array(navNodeSchema) }).strict()
)
export const cmsNavWireResultSchema = z.object({
  tree: z.array(navNodeSchema), collection: nonEmptyString, locale: localeResolutionSchema
}).strict()
export const cmsSurroundWireResultSchema = z.object({
  previous: z.array(cmsPublicEntryWireSchema).max(10), next: z.array(cmsPublicEntryWireSchema).max(10),
  collection: nonEmptyString, locale: localeResolutionSchema
}).strict()
export const cmsSearchWireResultSchema = z.object({
  results: z.array(cmsPublicEntryWireSchema).max(50), pageInfo: pageInfoSchema,
  locale: localeResolutionSchema
}).strict()
export const cmsRoutesWireResultSchema = z.object({
  routes: z.array(z.object({
    collection: nonEmptyString, stableId: nonEmptyString, locale: nonEmptyString,
    path: sitePath, sitemapIncluded: z.boolean(), lastmod: isoDate
  }).strict()).max(1000),
  pageInfo: pageInfoSchema,
  snapshot: nonEmptyString.max(256)
}).strict()
export const cmsSiteDataWireResultSchema = z.object({
  key: nonEmptyString, data: jsonValueSchema.nullable(), locale: localeResolutionSchema
}).strict()

const parse = <T>(schema: z.ZodType<T>, operation: string, value: unknown): T => {
  try {
    assertBoundedWireValue(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CMS wire value is not bounded.'
    throw new TypeError(`Invalid CMS ${operation} wire result at result: ${message}`)
  }
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const path = issue?.path.length ? issue.path.join('.') : 'result'
  throw new TypeError(`Invalid CMS ${operation} wire result at ${path}: ${issue?.message || 'invalid value'}`)
}
export const parseCmsPageWireResult = (value: unknown) => parse(cmsPageWireResultSchema, 'page', value)
export const parseCmsListWireResult = (value: unknown) => parse(cmsListWireResultSchema, 'list', value)
export const parseCmsNavWireResult = (value: unknown) => parse(cmsNavWireResultSchema, 'navigation', value)
export const parseCmsSurroundWireResult = (value: unknown) => parse(cmsSurroundWireResultSchema, 'surroundings', value)
export const parseCmsSearchWireResult = (value: unknown) => parse(cmsSearchWireResultSchema, 'search', value)
export const parseCmsRoutesWireResult = (value: unknown) => parse(cmsRoutesWireResultSchema, 'routes', value)
export const parseCmsSiteDataWireResult = (value: unknown) => parse(cmsSiteDataWireResultSchema, 'site data', value)

export const assertCmsRequestedFacts = (args: {
  operation: string
  requested: { collection?: string, locale?: string }
  returned: {
    collection?: string
    locale?: { requested?: string }
    page?: CmsPublicEntryWire | null
    entries?: CmsPublicEntryWire[]
    results?: CmsPublicEntryWire[]
    previous?: CmsPublicEntryWire[]
    next?: CmsPublicEntryWire[]
  }
}) => {
  if (
    args.requested.collection &&
    args.returned.collection !== undefined &&
    args.returned.collection !== args.requested.collection
  ) {
    throw new TypeError(`Invalid CMS ${args.operation} wire result: returned collection does not match the request.`)
  }
  if (args.requested.locale && args.returned.locale?.requested !== args.requested.locale) {
    throw new TypeError(`Invalid CMS ${args.operation} wire result: returned locale does not match the request.`)
  }
  const entries = [
    ...(args.returned.page ? [args.returned.page] : []),
    ...(args.returned.entries ?? []),
    ...(args.returned.results ?? []),
    ...(args.returned.previous ?? []),
    ...(args.returned.next ?? [])
  ]
  const identities = new Set<string>()
  for (const entry of entries) {
    if (args.requested.collection && entry.collection !== args.requested.collection) {
      throw new TypeError(`Invalid CMS ${args.operation} wire result: an entry substituted another collection.`)
    }
    if (args.requested.locale && entry.locale.requested !== args.requested.locale) {
      throw new TypeError(`Invalid CMS ${args.operation} wire result: an entry substituted another requested locale.`)
    }
    if (entry.route.locale !== entry.locale.resolved) {
      throw new TypeError(`Invalid CMS ${args.operation} wire result: entry route locale conflicts with locale resolution.`)
    }
    const identity = `${entry.collection}\u0000${entry.stableId}\u0000${entry.locale.resolved}`
    if (identities.has(identity)) {
      throw new TypeError(`Invalid CMS ${args.operation} wire result: duplicate canonical identity.`)
    }
    identities.add(identity)
  }
}
