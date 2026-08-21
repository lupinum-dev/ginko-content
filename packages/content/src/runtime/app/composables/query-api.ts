import type { NavItem, ParsedContent } from '../../../types/content'
import type {
  ContentQueryTransportInput,
  ContentCollectionTarget,
  ContentNavigationTreeItem,
  BacklinksOptions,
  BacklinksResult,
  BacklinkSource,
  CountOptions,
  DocumentFromHandle,
  ManyOptions,
  NavigationOptions,
  OneOptions,
  OptionsArg,
  PopulateSpec,
  PopulateFromOptions,
  PopulatedDocument,
  PaginationOptions,
  PaginationResultFor,
  QueryResultDocument,
  ResolveOneOptions,
  ResolveOneResultFor,
  SurroundOptions,
  SurroundResult
} from '../../../types/query'
import type { ContentPublicQueryResponse } from '../../../types/api'
import type { __ginkoSchemaBrand } from '../../../types/config'
import {
  createPrerenderPathAdder,
  fetchContentApi,
  getContentApiFetcher,
  getPreviewToken
} from './utils'
import { getContentRuntime } from './runtime'
import {
  backlinks as backlinksWithContext,
  count as countWithContext,
  many as manyWithContext,
  navigation as navigationWithContext,
  one as oneWithContext,
  paginate as paginateWithContext,
  resolveOne as resolveOneWithContext,
  surround as surroundWithContext
} from '../../../features/query/unified'
import type { ContentQueryContext } from '../../../features/query/context'

export const createClientContentQueryContext = (): ContentQueryContext => {
  const runtime = getContentRuntime()
  const fetcher = getContentApiFetcher()
  // `null` is the captured "no token" value. Leaving this as `undefined`
  // would make nested queries call the Nuxt cookie composable again after an
  // async boundary, where setup context is no longer available.
  const previewToken = getPreviewToken() ?? null
  // Nested navigation and surround queries can begin after an async boundary.
  // Capture the request-bound prerender writer while setup context is active.
  const addPrerenderPath = createPrerenderPathAdder()

  return {
    runtime,
    transport: async <T>(endpoint: 'query' | 'navigation', params: ContentQueryTransportInput) => {
      return await fetchContentApi<ContentPublicQueryResponse<T> | NavItem[]>(
        endpoint,
        params,
        { fetcher, runtime, previewToken, addPrerenderPath }
      )
    }
  }
}

export async function resolveOne<
  const H extends ContentCollectionTarget,
  O extends ResolveOneOptions<H, PopulateSpec | undefined>
>(
  handle: H,
  options: O
): Promise<ResolveOneResultFor<H, O>> {
  return await resolveOneWithContext(createClientContentQueryContext(), handle, options)
}

export async function one<
  const H extends ContentCollectionTarget,
  O extends OneOptions<H, PopulateSpec | undefined>
>(
  handle: H,
  options: O
): Promise<QueryResultDocument<H, O> | null> {
  return await oneWithContext(createClientContentQueryContext(), handle, options)
}

export async function many<
  const H extends ContentCollectionTarget,
  O extends ManyOptions<H, PopulateSpec | undefined>
>(
  handle: H,
  ...args: OptionsArg<H, O & ManyOptions<H, PopulateSpec | undefined>>
): Promise<Array<QueryResultDocument<H, O>>> {
  const options = (args[0] ?? {}) as O & ManyOptions<H, PopulateSpec | undefined>
  return await manyWithContext(createClientContentQueryContext(), handle, options)
}

export async function count<
  const H extends ContentCollectionTarget,
  O extends CountOptions<H>
>(
  handle: H,
  ...args: OptionsArg<H, O>
): Promise<number> {
  return await countWithContext(createClientContentQueryContext(), handle, (args[0] ?? {}) as O)
}

export async function paginate<
  const H extends ContentCollectionTarget,
  O extends PaginationOptions<H, PopulateSpec | undefined>
>(
  handle: H,
  options: O
): Promise<PaginationResultFor<O, PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>> {
  return await paginateWithContext(createClientContentQueryContext(), handle, options) as unknown as PaginationResultFor<O, PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>
}

export async function backlinks<
  const Target extends ContentCollectionTarget,
  const Source extends BacklinkSource | ReadonlyArray<BacklinkSource>,
  P extends PopulateSpec | undefined = undefined
>(
  handle: Target,
  options: BacklinksOptions<Target, Source, P>
): Promise<BacklinksResult<Source, P>> {
  return await backlinksWithContext(createClientContentQueryContext(), handle, options)
}

export async function navigation<
  H extends ContentCollectionTarget,
  Select extends ReadonlyArray<string> | undefined = undefined
>(
  handle: H,
  ...args: OptionsArg<H, Omit<NavigationOptions<H>, 'select'> & { select?: Select }>
): Promise<ContentNavigationTreeItem<H extends { [__ginkoSchemaBrand]: { _output: infer O } } ? O & ParsedContent : ParsedContent, Select>[]> {
  const options = (args[0] ?? {}) as Omit<NavigationOptions<H>, 'select'> & { select?: Select }
  return await navigationWithContext(createClientContentQueryContext(), handle, options)
}

export async function surround<H extends ContentCollectionTarget>(
  handle: H,
  options: SurroundOptions<H>
): Promise<SurroundResult<H extends { [__ginkoSchemaBrand]: { _output: infer O } } ? O & ParsedContent : ParsedContent>> {
  return await surroundWithContext(createClientContentQueryContext(), handle, options)
}
