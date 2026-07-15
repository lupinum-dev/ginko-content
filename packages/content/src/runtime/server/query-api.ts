import type { H3Event } from 'h3'
import type { NavItem, ParsedContent } from '../../types/content'
import type { ContentCollectionHandle, __ginkoSchemaBrand } from '../../types/config'
import type {
  BacklinksOptions,
  BacklinksResult,
  BacklinkSource,
  ContentNavigationTreeItem,
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
} from '../../types/query'
import {
  backlinks as backlinksWithContext,
  many as manyWithContext,
  navigation as navigationWithContext,
  one as oneWithContext,
  paginate as paginateWithContext,
  resolveOne as resolveOneWithContext,
  surround as surroundWithContext,
  type ContentQueryContext
} from '../../features/query/unified'
import { getContentProvider } from './providers'
import { createContentProviderError } from '../../public/provider-errors'
import { getContentRuntimeConfig } from './runtime-config'
import { createProviderNavigationQuery, createProviderQuery, normalizeProviderQueryResponse } from './provider-query'
import { projectProviderNavigation, projectProviderSurroundings } from './provider-route-facts'
import { stripLocalePrefix } from '../../core/content/path'

export const createServerContentQueryContext = async (event: H3Event): Promise<ContentQueryContext> => {
  const provider = await getContentProvider(event)
  const runtime = getContentRuntimeConfig().content || {}

  return {
    runtime,
    ...(provider.surroundings
      ? {
          surroundings: async (collection, resolvedPath, options) => {
            const collectionI18n = runtime.collections?.[collection]?.i18n
            const locales = collectionI18n && typeof collectionI18n === 'object' && collectionI18n.locales?.length
              ? collectionI18n.locales
              : (runtime.locales || [])
            const defaultLocale = collectionI18n && typeof collectionI18n === 'object'
              ? collectionI18n.defaultLocale || runtime.defaultLocale
              : runtime.defaultLocale
            const contentPath = stripLocalePrefix(
              resolvedPath,
              locales,
              defaultLocale,
              options.resolvedLocale
            ).path
            return projectProviderSurroundings(
              await provider.surroundings!(event, collection, contentPath, {
                ...(options.locale ? { locale: options.locale } : {}),
                ...(options.fallback !== undefined ? { fallback: options.fallback } : {}),
                ...(options.select ? { select: options.select } : {})
              }),
              provider.name,
              runtime
            ) as NavItem[]
          }
        }
      : {}),
    transport: async (endpoint, params) => {
      if (endpoint === 'navigation') {
        if (!provider.navigation) {
          throw createContentProviderError('unsupported_provider_operation', `${provider.name} does not support navigation queries`, {
            provider: provider.name
          })
        }
        const { query, options } = createProviderNavigationQuery(params)
        return projectProviderNavigation(
          await provider.navigation(event, query, options),
          provider.name,
          runtime,
          options.locale
        ) as NavItem[]
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
): Promise<ResolveOneResult<SelectedInnerDocument<PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>, O>>> {
  return await resolveOneWithContext(await createServerContentQueryContext(event), handle, options)
}

export async function one<
  const H extends ContentCollectionHandle | string,
  O extends OneOptions<H, PopulateSpec | undefined>
>(
  event: H3Event,
  handle: H,
  options: O
): Promise<QueryResultDocument<H, O> | null> {
  return await oneWithContext(await createServerContentQueryContext(event), handle, options)
}

export async function many<
  const H extends ContentCollectionHandle | string,
  O extends ManyOptions<H, PopulateSpec | undefined>
>(
  event: H3Event,
  handle: H,
  ...args: OptionsArg<H, O>
): Promise<Array<QueryResultDocument<H, O>>> {
  const options = (args[0] ?? {}) as O
  return await manyWithContext(await createServerContentQueryContext(event), handle, options)
}

export async function paginate<
  const H extends ContentCollectionHandle | string,
  O extends PaginationOptions<H, PopulateSpec | undefined>
>(
  event: H3Event,
  handle: H,
  options: O
): Promise<PaginationResultFor<O, PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>> {
  return await paginateWithContext(await createServerContentQueryContext(event), handle, options) as unknown as PaginationResultFor<O, PopulatedDocument<DocumentFromHandle<H>, PopulateFromOptions<O>>>
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

export async function navigation<
  H extends ContentCollectionHandle | string,
  Select extends ReadonlyArray<string> | undefined = undefined
>(
  event: H3Event,
  handle: H,
  ...args: OptionsArg<H, Omit<NavigationOptions<H>, 'select'> & { select?: Select }>
): Promise<ContentNavigationTreeItem<H extends { [__ginkoSchemaBrand]: { _output: infer O } } ? O & ParsedContent : ParsedContent, Select>[]> {
  const options = (args[0] ?? {}) as Omit<NavigationOptions<H>, 'select'> & { select?: Select }
  return await navigationWithContext(await createServerContentQueryContext(event), handle, options)
}

export async function surround<H extends ContentCollectionHandle | string>(
  event: H3Event,
  handle: H,
  options: SurroundOptions<H>
): Promise<SurroundResult<H extends { [__ginkoSchemaBrand]: { _output: infer O } } ? O & ParsedContent : ParsedContent>> {
  return await surroundWithContext(await createServerContentQueryContext(event), handle, options)
}
