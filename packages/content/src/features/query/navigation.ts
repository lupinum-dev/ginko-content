import type { ParsedContent } from '../../types/content'
import type { ContentCollectionHandle, __ginkoSchemaBrand  } from '../../types/config'
import type {
  ContentNavigationTreeItem,
  LocalizedContentDocument,
  NavigationOptions,
  OneOptions,
  QueryWhere,
  SurroundOptions,
  SurroundResult
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

type NavigationResolver = <
  H extends ContentCollectionHandle | string,
  Select extends ReadonlyArray<string> | undefined = undefined
>(
  context: ContentQueryContext,
  handle: H,
  options: Omit<NavigationOptions<H>, 'select'> & { select?: Select }
) => Promise<unknown[]>

/**
 * Resolve the navigation tree for a collection — the public `navigation()`
 * verb, absorbing the deleted `tree()` operation.
 */
export async function resolveNavigation<
  H extends ContentCollectionHandle | string,
  Select extends ReadonlyArray<string> | undefined = undefined
>(
  context: ContentQueryContext,
  handle: H,
  options: Omit<NavigationOptions<H>, 'select'> & { select?: Select } = {} as Omit<NavigationOptions<H>, 'select'> & { select?: Select }
): Promise<ContentNavigationTreeItem<H extends { [__ginkoSchemaBrand]: { _output: infer O } } ? O & ParsedContent : ParsedContent, Select>[]> {
  const collection = ensureCollectionName(handle)
  const runtime = context.runtime
  const fallback = resolveFallback(options.fallback, collection, runtime)
  const params = compileQueryParams({
    collection,
    where: options.where as QueryWhere | undefined,
    sort: options.sort,
    locale: options.locale,
    fallback,
    select: navigationSelectFields(options.select as ReadonlyArray<string> | undefined),
    exact: options.fallback === undefined ? false : undefined
  })

  const response = await context.transport('navigation', params)
  const list = Array.isArray(response)
    ? response
    : Array.isArray((response as { result?: unknown })?.result)
      ? (response as { result: unknown[] }).result
      : []
  return list as ContentNavigationTreeItem<H extends { [__ginkoSchemaBrand]: { _output: infer O } } ? O & ParsedContent : ParsedContent, Select>[]
}

/**
 * Return the previous/next navigation entries surrounding a document — the
 * public `surround()` verb, replacing `neighbors()`.
 * `previous`, never `prev`.
 */
export async function resolveSurround<H extends ContentCollectionHandle | string>(
  context: ContentQueryContext,
  one: OneResolver,
  navigation: NavigationResolver,
  handle: H,
  options: SurroundOptions<H>
): Promise<SurroundResult<H extends { [__ginkoSchemaBrand]: { _output: infer O } } ? O & ParsedContent : ParsedContent>> {
  const collection = ensureCollectionName(handle)
  const runtime = context.runtime
  const seed = await one(context, handle, {
    by: options.by,
    locale: options.locale,
    fallback: options.fallback ?? true
  } as unknown as OneOptions<H>)

  if (!seed) return { previous: null, next: null }

  if (context.surroundings) {
    const fallback = resolveFallback(options.fallback, collection, runtime)
    const items = await context.surroundings(collection, seed.route.resolvedPath, {
      ...(options.locale ? { locale: options.locale } : {}),
      ...(seed.resolution.resolved.locale ? { resolvedLocale: seed.resolution.resolved.locale } : {}),
      ...(fallback !== undefined
        ? { fallback: typeof fallback === 'string' ? [fallback] : fallback }
        : {}),
      ...(options.select ? { select: options.select.map(String) } : {})
    })
    return {
      previous: (items[0] as ContentNavigationTreeItem<ParsedContent> | null | undefined) ?? null,
      next: (items[1] as ContentNavigationTreeItem<ParsedContent> | null | undefined) ?? null
    } as SurroundResult<H extends { [__ginkoSchemaBrand]: { _output: infer O } } ? O & ParsedContent : ParsedContent>
  }

  const fullTree = await navigation(context, handle, {
    locale: options.locale,
    fallback: options.fallback,
    select: options.select
  } as NavigationOptions<H>)

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

  const targetPath = seed.route.resolvedPath
  const idx = flat.findIndex(entry => entry.path === targetPath)
  if (idx === -1 && (isCollectionRouteRoot(targetPath, collection, runtime) || isNavigationRootPath(targetPath, flat))) {
    return {
      previous: null,
      next: (flat[0]?.item as unknown as ContentNavigationTreeItem<ParsedContent>) ?? null
    } as SurroundResult<H extends { [__ginkoSchemaBrand]: { _output: infer O } } ? O & ParsedContent : ParsedContent>
  }
  if (idx === -1) return { previous: null, next: null }
  return {
    previous: (flat[idx - 1]?.item as unknown as ContentNavigationTreeItem<ParsedContent>) ?? null,
    next: (flat[idx + 1]?.item as unknown as ContentNavigationTreeItem<ParsedContent>) ?? null
  } as SurroundResult<H extends { [__ginkoSchemaBrand]: { _output: infer O } } ? O & ParsedContent : ParsedContent>
}
