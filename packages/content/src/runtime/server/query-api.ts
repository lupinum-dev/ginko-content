import type { H3Event } from 'h3'
import type { ParsedContent } from '../../types/content'
import type { ContentCollectionHandle } from '../../types/config'
import type {
  BacklinksOptions,
  BacklinksResult,
  BacklinkSource,
  ContentVariant,
  ContentTreeItem,
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
} from '../../types/query'
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
} from '../query/unified'
import { getContentProvider } from './providers'
import { createContentProviderError } from '../../public/provider-errors'
import { getContentRuntimeConfig } from './runtime-config'
import { createProviderNavigationQuery, createProviderQuery, normalizeProviderQueryResponse } from './provider-query'

export const createServerContentQueryContext = async (event: H3Event): Promise<ContentQueryContext> => {
  const provider = await getContentProvider(event)

  return {
    runtime: getContentRuntimeConfig().content,
    transport: async (endpoint, params) => {
      if (endpoint === 'navigation') {
        if (!provider.navigationQuery) {
          throw createContentProviderError('unsupported_provider_operation', `${provider.name} does not support navigation queries`, {
            provider: provider.name
          })
        }
        const { query, options } = createProviderNavigationQuery(params)
        return await provider.navigationQuery(event, query, options)
      }
      return normalizeProviderQueryResponse(params, await provider.query(event, createProviderQuery(params)), provider.name)
    }
  }
}

export async function resolveOne<
  const H extends ContentCollectionHandle | string,
  O extends ResolveOneOptions<H, PopulateSpec | undefined>
>(
  event: H3Event,
  handle: H,
  options: O
): Promise<ResolveOneResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>> {
  return await resolveOneWithContext(await createServerContentQueryContext(event), handle, options)
}

export async function one<
  const H extends ContentCollectionHandle | string,
  O extends OneOptions<H, PopulateSpec | undefined>
>(
  event: H3Event,
  handle: H,
  options: O
): Promise<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>> | null> {
  return await oneWithContext(await createServerContentQueryContext(event), handle, options)
}

export async function many<
  const H extends ContentCollectionHandle | string,
  O extends ManyOptions<H, PopulateSpec | undefined>
>(
  event: H3Event,
  handle: H,
  options: O = {} as O
): Promise<Array<LocalizedDoc<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>>> {
  return await manyWithContext(await createServerContentQueryContext(event), handle, options)
}

export async function paginate<
  const H extends ContentCollectionHandle | string,
  O extends PaginationOptions<H, PopulateSpec | undefined>
>(
  event: H3Event,
  handle: H,
  options: O
): Promise<PaginationResult<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>> {
  return await paginateWithContext(await createServerContentQueryContext(event), handle, options)
}

export async function backlinks<
  const Target extends ContentCollectionHandle | string,
  const Source extends BacklinkSource | ReadonlyArray<BacklinkSource>,
  P extends PopulateSpec | undefined = undefined
>(
  event: H3Event,
  handle: Target,
  options: BacklinksOptions<Target, Source, P>
): Promise<BacklinksResult<Source, P>> {
  return await backlinksWithContext(await createServerContentQueryContext(event), handle, options)
}

export async function variants<H extends ContentCollectionHandle | string>(
  event: H3Event,
  handle: H,
  options: VariantsOptions<H>
): Promise<Array<ContentVariant<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>>> {
  return await variantsWithContext(await createServerContentQueryContext(event), handle, options)
}

export async function tree<
  H extends ContentCollectionHandle | string,
  Fields extends ReadonlyArray<string> | undefined = undefined
>(
  event: H3Event,
  handle: H,
  options: Omit<TreeOptions<H>, 'fields'> & { fields?: Fields } = {} as Omit<TreeOptions<H>, 'fields'> & { fields?: Fields }
): Promise<ContentTreeItem<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent, Fields>[]> {
  return await treeWithContext(await createServerContentQueryContext(event), handle, options)
}

export async function neighbors<H extends ContentCollectionHandle | string>(
  event: H3Event,
  handle: H,
  options: NeighborsOptions<H>
): Promise<NeighborsResult<H extends { __schema: { _output: infer O } } ? O & ParsedContent : ParsedContent>> {
  return await neighborsWithContext(await createServerContentQueryContext(event), handle, options)
}
