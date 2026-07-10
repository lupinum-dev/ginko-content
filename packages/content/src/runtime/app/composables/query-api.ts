import type { NavItem, ParsedContent } from '../../../types/content'
import type {
  ContentQueryBuilderParams,
  ContentCollectionTarget,
  ContentNavigationTreeItem,
  BacklinksOptions,
  BacklinksResult,
  BacklinkSource,
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
  ResolveOneResult,
  SelectedInnerDocument,
  SurroundOptions,
  SurroundResult
} from '../../../types/query'
import type { ContentQueryResponse } from '../../../types/api'
import type { __ginkoSchemaBrand } from '../../../types/config'
import { fetchContentApi, getContentApiFetcher } from './utils'
import { getContentRuntime } from './runtime'
import {
  backlinks as backlinksWithContext,
  many as manyWithContext,
  navigation as navigationWithContext,
  one as oneWithContext,
  paginate as paginateWithContext,
  resolveOne as resolveOneWithContext,
  surround as surroundWithContext,
  type ContentQueryContext
} from '../../../features/query/unified'

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
): Promise<ResolveOneResult<SelectedInnerDocument<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>, O>>> {
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
