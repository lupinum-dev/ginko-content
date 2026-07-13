import { z } from 'zod'

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(), z.boolean(), z.number().finite(), z.string(),
    z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)
  ])
)
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

export const cmsPublicEntryWireSchema = z.object({
  id: nonEmptyString, collection: nonEmptyString, route: routeSchema,
  translations: z.array(translationSchema), locale: localeResolutionSchema,
  title: z.string(), data: publicDataSchema, bodyAst: jsonValueSchema.optional(),
  toc: jsonValueSchema.optional(), publishedAt: isoDate, updatedAt: isoDate,
  revision: nonEmptyString, stableId: nonEmptyString
}).strict()
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
const navNodeSchema: z.ZodType<unknown> = z.lazy(() =>
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
  pageInfo: pageInfoSchema
}).strict()
export const cmsSiteDataWireResultSchema = z.object({
  key: nonEmptyString, data: jsonValueSchema.nullable(), locale: localeResolutionSchema
}).strict()

export type CmsPublicEntryWire = z.infer<typeof cmsPublicEntryWireSchema>
const parse = <T>(schema: z.ZodType<T>, operation: string, value: unknown): T => {
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
