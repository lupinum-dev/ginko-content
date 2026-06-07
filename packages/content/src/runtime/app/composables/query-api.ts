import type { NavItem, ParsedContent } from '../../../types/content'
import type {
  ContentQueryBuilderParams,
  ContentCollectionTarget,
  ContentVariant,
  ContentTreeItem,
  BacklinksOptions,
  BacklinksResult,
  BacklinkSource,
  DocumentFromHandle,
  ManyOptions,
  LocalizedDoc,
  NeighborsOptions,
  NeighborsResult,
  OneOptions,
  PopulateSpec,
  PopulateFromOptions,
  PopulatedDocument,
  PaginationOptions,
  PaginationResult,
  ResolveOneOptions,
  ResolveOneResult,
  TreeOptions,
  VariantsOptions
} from '../../../types/query'
import type { ContentQueryResponse } from '../../../types/api'
import { fetchContentApi, getContentApiFetcher } from './utils'
import { getContentRuntime } from './runtime'
import {
  backlinks as backlinksWithContext,
  many as manyWithContext,
  neighbors as neighborsWithContext,
  one as oneWithContext,
  paginate as paginateWithContext,
  resolveOne as resolveOneWithContext,
  tree as treeWithContext,
  variants as variantsWithContext,
  type ContentQueryContext
} from '../../query/unified'

export const createClientContentQueryContext = (): ContentQueryContext => {
  const runtime = getContentRuntime()
  const fetcher = getContentApiFetcher()

  return {
    runtime,
    transport: async <T>(endpoint: 'query' | 'navigation', params: ContentQueryBuilderParams) => {
      return await fetchContentApi<ContentQueryResponse<T> | T | T[] | NavItem[] | null>(endpoint, params, { fetcher, runtime })
    }
  }
}

export async function resolveOne<
  const H extends ContentCollectionTarget,
  O extends ResolveOneOptions<H, PopulateSpec | undefined>
>(
  handle: H,
  options: O
): Promise<ResolveOneResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>> {
  return await resolveOneWithContext(createClientContentQueryContext(), handle, options)
}

export async function one<
  const H extends ContentCollectionTarget,
  O extends OneOptions<H, PopulateSpec | undefined>
>(
  handle: H,
  options: O
): Promise<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>> | null> {
  return await oneWithContext(createClientContentQueryContext(), handle, options)
}

export async function many<
  const H extends ContentCollectionTarget,
  O extends ManyOptions<H, PopulateSpec | undefined>
>(
  handle: H,
  options: O & ManyOptions<H, PopulateSpec | undefined> = {} as O & ManyOptions<H, PopulateSpec | undefined>
): Promise<Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>> {
  return await manyWithContext(createClientContentQueryContext(), handle, options)
}

export async function paginate<
  const H extends ContentCollectionTarget,
  O extends PaginationOptions<H, PopulateSpec | undefined>
>(
  handle: H,
  options: O
): Promise<PaginationResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>> {
  return await paginateWithContext(createClientContentQueryContext(), handle, options)
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

export async function variants<H extends ContentCollectionTarget>(
  handle: H,
  options: VariantsOptions<H>
): Promise<Array<ContentVariant<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>>> {
  return await variantsWithContext(createClientContentQueryContext(), handle, options)
}

export async function tree<
  H extends ContentCollectionTarget,
  Fields extends ReadonlyArray<string> | undefined = undefined
>(
  handle: H,
  options: Omit<TreeOptions<H>, 'fields'> & { fields?: Fields } = {} as Omit<TreeOptions<H>, 'fields'> & { fields?: Fields }
): Promise<ContentTreeItem<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent, Fields>[]> {
  return await treeWithContext(createClientContentQueryContext(), handle, options)
}

export async function neighbors<H extends ContentCollectionTarget>(
  handle: H,
  options: NeighborsOptions<H>
): Promise<NeighborsResult<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>> {
  return await neighborsWithContext(createClientContentQueryContext(), handle, options)
}
