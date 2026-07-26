import type { ParsedContent } from '../../packages/content/src/types/content'

export const markdownBody = (
  children: NonNullable<ParsedContent['body']>['children']
): ParsedContent['body'] => ({
  type: 'root',
  children
})

export const providerDocumentFor = (
  page: Partial<ParsedContent> & Record<string, unknown>
) => {
  const {
    path,
    resolved: _resolved,
    variants: _variants,
    localePaths: _localePaths,
    unprefixedPath: _unprefixedPath,
    dir: _dir,
    route: _route,
    resolution: _resolution,
    ...providerFields
  } = page
  const collection = String(page.collection || 'docs')
  const locale = String(page.locale || 'en')
  const contentPath = String(path || '/')
  return {
    ...providerFields,
    collection,
    canonicalKey: String(page.canonicalKey || `${collection}:${contentPath.replace(/^\//, '')}`),
    locale,
    contentPath,
    routeVariants: [{ locale, contentPath }],
    body: page.body ?? null
  }
}

export const providerListResponse = (query: any, documents: unknown[]) => {
  const skip = query.plan.pagination.skip
  const limit = query.plan.pagination.limit ?? 100
  return { result: documents.slice(skip, skip + limit), skip, limit, total: documents.length }
}

export const providerForPage = (page: Partial<ParsedContent> & Record<string, unknown>) => ({
  name: 'fixture',
  query: async (_event: unknown, query: any) => {
    const document = providerDocumentFor(page)
    if (query.plan.mode === 'first') return { result: document }
    if (query.plan.mode === 'count') return { result: 1 }
    return providerListResponse(query, [document])
  }
})
