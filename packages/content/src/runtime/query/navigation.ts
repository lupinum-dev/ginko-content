import type { ParsedContent } from '../../types/content'
import type { ContentCollectionHandle } from '../../types/config'
import type {
  ContentTreeItem,
  LocalizedContentDocument,
  NeighborsOptions,
  NeighborsResult,
  OneOptions,
  QueryWhere,
  TreeOptions
} from '../../types/query'
import { compileQueryParams } from '../../core/query/filter'
import type { ContentQueryContext } from './context'
import { ensureCollectionName } from './handles'
import { isCollectionRouteRoot, isNavigationRootPath } from './localized-docs'
import { resolveFallback } from './locale-options'

const NAVIGATION_INTERNAL_FIELDS = [
  'id',
  'path',
  'file',
  'canonicalKey',
  'locale',
  'draft',
  'navigation',
  'title'
] as const

export const navigationSelectFields = (fields: ReadonlyArray<string> | undefined = []) => [
  ...new Set([...NAVIGATION_INTERNAL_FIELDS, ...fields])
]

type OneResolver = <H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  handle: H,
  options: OneOptions<H>
) => Promise<LocalizedContentDocument<ParsedContent> | null>

type TreeResolver = <
  H extends ContentCollectionHandle | string,
  Fields extends ReadonlyArray<string> | undefined = undefined
>(
  context: ContentQueryContext,
  handle: H,
  options?: Omit<TreeOptions<H>, 'fields'> & { fields?: Fields }
) => Promise<unknown[]>

export async function resolveTree<
  H extends ContentCollectionHandle | string,
  Fields extends ReadonlyArray<string> | undefined = undefined
>(
  context: ContentQueryContext,
  handle: H,
  options: Omit<TreeOptions<H>, 'fields'> & { fields?: Fields } = {} as Omit<TreeOptions<H>, 'fields'> & { fields?: Fields }
): Promise<ContentTreeItem<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent, Fields>[]> {
  const collection = ensureCollectionName(handle)
  const runtime = context.runtime
  const fallback = resolveFallback(options.fallback, collection, runtime)
  const params = compileQueryParams({
    collection,
    where: options.where as QueryWhere | undefined,
    sort: options.sort,
    locale: options.locale,
    fallback,
    select: navigationSelectFields(options.fields as ReadonlyArray<string> | undefined),
    exact: options.fallback === undefined ? false : undefined
  })

  const response = await context.transport('navigation', params)
  const list = Array.isArray(response)
    ? response
    : Array.isArray((response as { result?: unknown })?.result)
      ? (response as { result: unknown[] }).result
      : []
  return list as ContentTreeItem<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent, Fields>[]
}

export async function resolveNeighbors<H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  one: OneResolver,
  tree: TreeResolver,
  handle: H,
  options: NeighborsOptions<H>
): Promise<NeighborsResult<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>> {
  const collection = ensureCollectionName(handle)
  const runtime = context.runtime
  const seed = await one(context, handle, {
    by: options.by,
    locale: options.locale,
    fallback: options.fallback ?? true
  } as unknown as OneOptions<H>)

  if (!seed) return { prev: null, next: null }

  const fullTree = await tree(context, handle, {
    locale: options.locale,
    fallback: options.fallback,
    fields: options.fields
  } as TreeOptions<H>)

  const flat: Array<{ path: string, item: unknown }> = []
  const walk = (nodes: unknown[]) => {
    for (const node of nodes) {
      const n = node as { path?: string, children?: unknown[] }
      if (n.path) {
        flat.push({ path: n.path || '', item: node })
      }
      if (Array.isArray(n.children)) walk(n.children)
    }
  }
  walk(fullTree)

  const targetPath = seed.path
  const idx = flat.findIndex(entry => entry.path === targetPath)
  if (idx === -1 && (isCollectionRouteRoot(targetPath, collection, runtime) || isNavigationRootPath(targetPath, flat))) {
    return {
      prev: null,
      next: (flat[0]?.item as unknown as ContentTreeItem<ParsedContent>) ?? null
    } as NeighborsResult<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>
  }
  if (idx === -1) return { prev: null, next: null }
  return {
    prev: (flat[idx - 1]?.item as unknown as ContentTreeItem<ParsedContent>) ?? null,
    next: (flat[idx + 1]?.item as unknown as ContentTreeItem<ParsedContent>) ?? null
  } as NeighborsResult<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>
}
